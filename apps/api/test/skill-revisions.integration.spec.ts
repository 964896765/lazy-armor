import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SkillCapability, SkillRepositoryProjection, SkillRevisionHistory } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const manifest: SkillCapability = { name: 'RevisionReviewMethod', version: '1.0.0', description: '设备耗材分析', domain: 'device', input: {}, output: {},
  requiredCapabilities: [], permission: [], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '隔离版本管理夹具，只能作为非可信规划参考。' };
describe.sequential('Owned immutable method revision management, NOT third-party acceptance', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session;
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('skill-revisions-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', 'Revision owner'); other = await register(app, randomUUID() + '@example.test', 'Other owner');
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function repository() {
    return (await request(app.getHttpServer()).post('/api/skill-repositories').set(auth(owner.token)).send({ package: {
      schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '版本测试库', sourceType: 'USER', entries: [manifest] } }).expect(201)).body as SkillRepositoryProjection;
  }
  const path = (repo: SkillRepositoryProjection) => `/api/skill-repositories/${repo.id}/entries/${repo.entries[0].id}/revisions`;
  const history = (repo: SkillRepositoryProjection, query = '') => request(app.getHttpServer()).get(path(repo) + query).set(auth(owner.token));
  const revise = (repo: SkillRepositoryProjection, changed: unknown, version = repo.version, token = owner.token) => request(app.getHttpServer())
    .post(path(repo)).set(auth(token)).send({ version, manifest: changed });
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths,(SELECT COUNT(*) FROM audit_logs WHERE user_id=UUID_TO_BIN(?)) audits,(SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations,(SELECT COUNT(*) FROM runtime_targets WHERE user_id=UUID_TO_BIN(?)) targets', Array(6).fill(owner.userId));
    return rows[0];
  }
  it('requires authentication, owner, matching entry and strict bounded pagination', async () => {
    const repo = await repository(), another = await repository();
    await request(app.getHttpServer()).get(path(repo)).expect(401);
    await request(app.getHttpServer()).get(path(repo)).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/skill-repositories/${repo.id}/entries/${another.entries[0].id}/revisions`).set(auth(owner.token)).expect(404);
    await revise(repo, { ...manifest, version: '1.1.0' }, repo.version, other.token).expect(404);
    for (const query of ['?limit=0', '?limit=-1', '?limit=1.5', '?limit=21', '?cursor=broken', '?enabled=true']) {
      expect((await history(repo, query)).status, query).toBe(400);
    }
    await history(repo, '?limit=20').expect(200);
    await request(app.getHttpServer()).get('/api/skill-repositories?limit=0').set(auth(owner.token)).expect(400);
  });
  it('reads history and the current marker without creating execution, Truth or audit records', async () => {
    const repo = await repository(), before = await counts();
    const view = (await history(repo).expect(200)).body as SkillRevisionHistory;
    expect(view).toMatchObject({ repositoryId: repo.id, repositoryVersion: repo.version, repositoryStatus: 'ACTIVE', entryId: repo.entries[0].id,
      currentRevisionId: repo.entries[0].revisionId, nextCursor: null, executionAuthorized: false });
    expect(view.items).toEqual([expect.objectContaining({ id: repo.entries[0].revisionId, version: '1.0.0', manifest, current: true })]);
    expect(await counts()).toEqual(before);
  });
  it('appends through the existing API, preserves disabled state and immutable history, and replays without writes', async () => {
    const repo = await repository(), original = (await history(repo).expect(200)).body.items[0], next = { ...manifest, version: '1.1.0', instruction: '新的非可信参考。' };
    const before = await counts(), updated = (await revise(repo, next).expect(201)).body as SkillRepositoryProjection;
    expect(updated).toMatchObject({ id: repo.id, version: 2, enabled: false, executionAuthorized: false });
    expect(updated.entries[0].id).toBe(repo.entries[0].id); expect(updated.entries[0].revisionId).not.toBe(original.id);
    const first = (await history(repo).expect(200)).body as SkillRevisionHistory;
    expect(first.items).toHaveLength(2); expect(first.items.find(item => item.id === original.id)).toEqual({ ...original, current: false });
    expect(first.items.filter(item => item.current).map(item => item.version)).toEqual(['1.1.0']);
    expect(await counts()).toEqual({ ...before, audits: Number(before.audits) + 1 });
    const after = await counts();
    const replay = (await revise(repo, next).expect(201)).body as SkillRepositoryProjection;
    expect(replay.version).toBe(2); expect(replay.entries[0].revisionId).toBe(updated.entries[0].revisionId);
    expect((await history(repo).expect(200)).body.items).toHaveLength(2); expect(await counts()).toEqual(after);
  });
  it('rejects same-version changes and stale preview after planning settings change', async () => {
    const repo = await repository();
    await revise(repo, { ...manifest, instruction: '覆盖原版本' }).expect(409);
    const enabled = (await request(app.getHttpServer()).post(`/api/skill-repositories/${repo.id}/planning`).set(auth(owner.token)).send({ version: repo.version, enabled: true }).expect(201)).body;
    await revise(repo, { ...manifest, version: '1.1.0' }).expect(409);
    const updated = (await revise(repo, { ...manifest, version: '1.1.0' }, enabled.version).expect(201)).body;
    expect(updated.enabled).toBe(true); expect(updated.version).toBe(3);
  });
  it('serializes competing previews so only one distinct revision succeeds', async () => {
    const repo = await repository();
    const results = await Promise.all([revise(repo, { ...manifest, version: '1.1.0' }), revise(repo, { ...manifest, version: '1.2.0' })]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect((await history(repo).expect(200)).body.items).toHaveLength(2);
  });
  it('serializes identical upload replay into one new revision', async () => {
    const repo = await repository(), next = { ...manifest, version: '1.1.0' }, before = await counts();
    const results = await Promise.all([revise(repo, next).expect(201), revise(repo, next).expect(201), revise(repo, next).expect(201)]);
    expect(new Set(results.map(result => result.body.entries[0].revisionId)).size).toBe(1);
    expect((await history(repo).expect(200)).body.items).toHaveLength(2);
    expect(await counts()).toEqual({ ...before, audits: Number(before.audits) + 1 });
  });
  it('refuses a superseded identical upload instead of restoring a historical version', async () => {
    const repo = await repository(), first = { ...manifest, version: '1.1.0' };
    const updated = (await revise(repo, first).expect(201)).body;
    const latest = (await revise(updated, { ...manifest, version: '1.2.0' }).expect(201)).body;
    const response = await revise(repo, first).expect(409); expect(response.body.message).toBe('SKILL_REVISION_SUPERSEDED');
    expect((await history(repo).expect(200)).body.currentRevisionId).toBe(latest.entries[0].revisionId);
  });
  it.each([{ ...manifest, version: '1.1.0', executionAuthorized: true }, { ...manifest, version: '1.1.0', credential: 'untrusted' },
    { ...manifest, version: '1.1.0', input: { text: 'x'.repeat(120001) } }])('rejects authority-bearing or oversized manifests without appending %#', async invalid => {
    const repo = await repository(), before = await counts();
    await revise(repo, invalid).expect(400); expect((await history(repo).expect(200)).body.items).toHaveLength(1); expect(await counts()).toEqual(before);
  });
  it('keeps archive history readable and refuses all further uploads', async () => {
    const repo = await repository();
    await request(app.getHttpServer()).delete(`/api/skill-repositories/${repo.id}`).set(auth(owner.token)).send({ version: repo.version }).expect(200);
    const view = (await history(repo).expect(200)).body as SkillRevisionHistory;
    expect(view.repositoryStatus).toBe('ARCHIVED'); expect(view.items).toHaveLength(1);
    await revise(repo, { ...manifest, version: '1.1.0' }, view.repositoryVersion).expect(409);
  });
  it('paginates tied timestamps without duplication or omissions', async () => {
    let repo = await repository();
    for (const version of ['1.1.0', '1.2.0', '1.3.0']) repo = (await revise(repo, { ...manifest, version }).expect(201)).body;
    await pool.query('UPDATE skill_entry_revisions SET created_at=? WHERE entry_id=UUID_TO_BIN(?)', [new Date('2026-10-01T00:00:00.000Z'), repo.entries[0].id]);
    const all: SkillRevisionHistory['items'] = []; let cursor: string | null = null;
    do { const view: SkillRevisionHistory = (await history(repo, '?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')).expect(200)).body;
      expect(view.items).toHaveLength(1); all.push(...view.items); cursor = view.nextCursor;
    } while (cursor);
    expect(all).toHaveLength(4); expect(new Set(all.map(item => item.id)).size).toBe(4); expect(all.filter(item => item.current)).toHaveLength(1);
  });
  it('rejects a corrupted historical record rather than projecting modified content', async () => {
    const repo = await repository(); await revise(repo, { ...manifest, version: '1.1.0' }).expect(201);
    await pool.query('UPDATE skill_entry_revisions SET content_hash=? WHERE id=UUID_TO_BIN(?)', ['0'.repeat(64), repo.entries[0].revisionId]);
    try { const response = await history(repo).expect(409); expect(response.body.message).toBe('SKILL_REVISION_INTEGRITY_MISMATCH'); }
    finally { await pool.query('UPDATE skill_entry_revisions SET content_hash=? WHERE id=UUID_TO_BIN(?)', [repo.entries[0].contentHash, repo.entries[0].revisionId]); }
  });
  it('keeps confirmed Plan references frozen and marks old conversations changed after a normal update', async () => {
    let repo = await repository();
    repo = (await request(app.getHttpServer()).post(`/api/skill-repositories/${repo.id}/planning`).set(auth(owner.token)).send({ version: repo.version, enabled: true }).expect(201)).body;
    const entry = repo.entries[0], conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN',
      methodRefs: [{ repositoryId: repo.id, repositoryVersion: repo.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }] }).expect(201)).body;
    const proposed = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
      .send({ version: 0, requestId: randomUUID(), content: '根据设备耗材建立更换提醒' }).expect(201)).body;
    const confirmed = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: proposed.version, confirmed: true }).expect(201)).body;
    const frozen = (await request(app.getHttpServer()).get(`/api/plans/${confirmed.planId}/methods`).set(auth(owner.token)).expect(200)).body;
    await revise(repo, { ...manifest, version: '1.1.0', requiredCapabilities: ['BROWSER_SUBMIT_FORM'], risk: 'R3' }).expect(201);
    expect((await request(app.getHttpServer()).get(`/api/plans/${confirmed.planId}/methods`).set(auth(owner.token)).expect(200)).body).toEqual(frozen);
    const current = (await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(current.methods[0]).toMatchObject({ state: 'CHANGED', version: '1.0.0' });
    expect((await history(repo).expect(200)).body.items).toHaveLength(2);
  });
});
