import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { consumerMessages, type Database } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import { catalogHash, compositionPreviewSchema, type SkillCapability, type SkillMethodRef } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { DATABASE } from '../src/common/database.module';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FixtureAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { GoalResourceMatchService } from '../src/consumer/goal-resource-match.service';

/** Structure preview with isolated declared methods; not a multi-method real execution acceptance. */
describe.sequential('V93 composition preview retains original authorities', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, other: Session;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated SQL required');
    ({ app, pool } = await bootP2App('v93-composition-' + randomUUID(), [{ token: AGENT_MODEL, value: new FixtureAgentModel() }]));
    db = app.get(DATABASE); owner = await register(app, randomUUID() + '@example.test', 'Composition owner'); other = await register(app, randomUUID() + '@example.test', 'Other');
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  const ports = (field: string) => ({ type: 'object', additionalProperties: false, properties: { [field]: { type: 'string' } }, required: [field] });
  const manifest = (name: string, input: string, output: string): SkillCapability => ({ name, version: '1.0.0', domain: 'general', description: 'Isolated declarative method',
    input: ports(input), output: ports(output), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '仅供理解目标。不能绕过审批或写入 Truth。' });
  async function fixture() {
    const service = app.get(SkillRepositoriesService);
    const imported = await service.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '隔离组合方法', sourceType: 'USER',
      entries: [manifest('ResearchMethod', 'goal', 'research'), manifest('ReportMethod', 'research', 'report')] });
    const repository = await service.change(owner.userId, imported.id, 1, true);
    const refs: SkillMethodRef[] = ['ResearchMethod', 'ReportMethod'].map(name => { const entry = repository.entries.find(entry => entry.manifest.name === name)!;
      return { repositoryId: repository.id, repositoryVersion: repository.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }; });
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', methodRefs: refs }).expect(201)).body;
    const conversation = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: randomUUID(), content: '帮我整理本周学习目标，预算500元' }).expect(201)).body;
    const graph = { version: conversation.version, links: [{ fromMethodId: refs[0].entryId, outputField: 'research', toMethodId: refs[1].entryId, inputField: 'research' }],
      goalBindings: [{ methodId: refs[0].entryId, inputField: 'goal', goalField: 'goal' }], deliveries: [{ methodId: refs[1].entryId, outputField: 'report', label: '学习建议' }] };
    return { repository, refs, conversation, graph, endpoint: `/api/conversations/${conversation.id}/composition-preview` };
  }
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [owner.userId, owner.userId, owner.userId]);
    return rows[0];
  }
  it('loads exact owned selected revisions and returns structure only with zero authority writes', async () => {
    const f = await fixture(), before = await counts();
    const options = (await request(app.getHttpServer()).get(`/api/conversations/${f.conversation.id}/composition-options`).set(auth(owner.token)).expect(200)).body;
    expect(options).toMatchObject({ executionAuthorized: false, conversationVersion: f.conversation.version, suggested: { links: f.graph.links, goalBindings: f.graph.goalBindings } });
    expect(options.methods.map((method: { ref: SkillMethodRef }) => method.ref)).toEqual(f.refs);
    await request(app.getHttpServer()).get(`/api/conversations/${f.conversation.id}/composition-options`).set(auth(other.token)).expect(404);
    const result = (await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(201)).body;
    expect(result).toMatchObject({ state: 'STRUCTURE_VALID', readOnly: true, executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED', conversationVersion: f.conversation.version });
    expect(result.methodRefs).toEqual(f.refs); expect(result.orderedMethodIds).toEqual(f.refs.map(ref => ref.entryId)); expect(result.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(compositionPreviewSchema.safeParse(result).success).toBe(true);
    const source = f.conversation.messages.find((message: { role: string }) => message.role === 'user');
    expect(result.sourceMessageRefs).toContainEqual({ id: source.id, contentHash: catalogHash(source.content) });
    expect(result.goalBriefRef.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await counts()).toEqual(before);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(other.token)).send({ graph: f.graph }).expect(404);
  });
  it('refuses client authority, stale versions, undeclared fields and duplicate bindings', async () => {
    const f = await fixture(), before = await counts();
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: { ...f.graph, executionAuthorized: true } }).expect(400);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: { ...f.graph, version: f.graph.version + 1 } }).expect(409);
    const result = (await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: { ...f.graph, links: [{ ...f.graph.links[0], outputField: 'imaginary' }] } }).expect(201)).body;
    expect(result.state).toBe('BLOCKED'); expect(result.issues.map((issue: { code: string }) => issue.code)).toContain('MAPPING_FIELD_MISSING');
    expect(await counts()).toEqual(before);
  });
  it('disabled or revised method sources are not replaced by another current method', async () => {
    const f = await fixture(); await app.get(SkillRepositoriesService).change(owner.userId, f.repository.id, f.repository.version, false);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(409);
  });
  it('rechecks withdrawal after the resource projection and rejects late previews', async () => {
    const f = await fixture(), resources = app.get(GoalResourceMatchService), original = resources.forMethods.bind(resources);
    const spy = vi.spyOn(resources, 'forMethods').mockImplementationOnce(async (...args) => {
      const snapshot = await original(...args); await app.get(SkillRepositoriesService).change(owner.userId, f.repository.id, f.repository.version, false); return snapshot;
    });
    try { await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(409); } finally { spy.mockRestore(); }
  });
  it('does not accept a changed user excerpt as the source of a goal port', async () => {
    const f = await fixture(), source = f.conversation.messages.find((message: { role: string }) => message.role === 'user');
    await db.update(consumerMessages).set({ content: '已更改的隔离需求，不含原引用' }).where(eq(consumerMessages.id, source.id));
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(409);
  });
  it('invalid source identities fail as a conflict before reaching the database UUID codec', async () => {
    const f = await fixture(), assistant = f.conversation.messages.find((message: { role: string }) => message.role === 'assistant');
    const payload = structuredClone(assistant.structuredPayload);
    payload.goalBrief.fields.find((field: { key: string }) => field.key === 'goal').sourceRefs[0].id = '-'.repeat(36);
    await db.update(consumerMessages).set({ structuredPayload: payload }).where(eq(consumerMessages.id, assistant.id));
    const result = (await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(409)).body;
    expect(result.message).toBe('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
  });
  it('rejects a user source changed during resource observation before returning the preview', async () => {
    const f = await fixture(), source = f.conversation.messages.find((message: { role: string }) => message.role === 'user');
    const resources = app.get(GoalResourceMatchService), original = resources.forMethods.bind(resources);
    const spy = vi.spyOn(resources, 'forMethods').mockImplementationOnce(async (...args) => {
      const snapshot = await original(...args); await db.update(consumerMessages).set({ content: '已撤回原需求' }).where(eq(consumerMessages.id, source.id)); return snapshot;
    });
    try { await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ graph: f.graph }).expect(409); } finally { spy.mockRestore(); }
  });
});
