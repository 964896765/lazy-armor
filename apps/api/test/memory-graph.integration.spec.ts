import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { MemoryService } from '../src/memory/memory.service';
import { AgentContextCompiler } from '../src/ai-adapter/agent-context-compiler.service';

describe.sequential('confirmed memory graph with version and revocation fencing', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session;
  let from: { id: string; version: number }, to: { id: string; version: number }, otherMemory: { id: string; version: number };
  const unique = randomUUID();
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test'; process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
    if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated test database required');
    ({ app, pool } = await bootP2App('memory-graph-' + unique));
    owner = await register(app, unique + '@example.test', 'Graph owner'); other = await register(app, randomUUID() + '@example.test', 'Other');
    for (const user of [owner, other]) await app.get(MemoryService).changeSettings(user.userId, { enabled: true, version: 0 });
    from = await memory(owner, '相机', '我使用 Canon R10 相机。');
    to = await memory(owner, '电池', '兼容型号 LP-E17。');
    otherMemory = await memory(other, '个人设备', '其他人的个人设备。');
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function memory(user: Session, title: string, content: string) {
    return (await request(app.getHttpServer()).post('/api/memory').set(auth(user.token)).send({ type: 'ASSET', title, content, requestId: randomUUID(), confirmed: true }).expect(201)).body;
  }
  const body = (requestId = randomUUID()) => ({ requestId, fromVersion: from.version, toId: to.id, toVersion: to.version, relation: 'USES', confirmed: true });
  async function relate() { return (await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send(body()).expect(201)).body; }
  it('requires explicit confirmation, owner endpoints and current versions', async () => {
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), confirmed: false }).expect(400);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(other.token)).send(body()).expect(404);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), toId: otherMemory.id }).expect(404);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), fromVersion: 2 }).expect(409);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), toId: from.id }).expect(400);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), weight: 999, authorized: true }).expect(400);
  });
  it('concurrent confirmation replays one relationship, with bounded owner graph projection', async () => {
    const input = body();
    const results = await Promise.all([1, 2, 3].map(() => request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send(input).expect(201)));
    expect(new Set(results.map(r => r.body.id)).size).toBe(1);
    const graph = (await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations?limit=1`).set(auth(owner.token)).expect(200)).body;
    expect(graph.items).toHaveLength(1); expect(graph.items[0]).toMatchObject({ fromId: from.id, fromVersion: 1, toId: to.id, toVersion: 1, relation: 'USES', weight: 1 });
    await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations?limit=101`).set(auth(owner.token)).expect(400);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...input, relation: 'OWNS' }).expect(409);
  });
  it('one-hop retrieval brings the battery into a camera goal without treating relations as Truth or instructions', async () => {
    const context = await app.get(MemoryService).context(owner.userId, '我的相机');
    expect(context.items.map(item => item.id)).toEqual([from.id, to.id]);
    expect(context.relations).toHaveLength(1);
    const compiled = new AgentContextCompiler().compile({ memoryContext: context, intent: '我的相机', domain: null, truths: [], scenarios: [], skills: [], capabilities: [], tools: [], evidence: [], untrustedSources: [] });
    const section = compiled.sections.find(section => section.title === 'PERSONAL MEMORY RELATION DATA')!;
    expect(section.kind).toBe('UNTRUSTED_SOURCE_CONTENT'); expect(section.content).toContain('USES');
    expect(JSON.parse(compiled.sections.find(s => s.kind === 'TRUSTED_RUNTIME_METADATA')!.content).truths).toEqual([]);
  });
  it('relationship removal invalidates the old snapshot; explicit new confirmation appends a new identity', async () => {
    const service = app.get(MemoryService), before = await service.context(owner.userId, '我的相机'), edge = before.relations![0];
    await request(app.getHttpServer()).delete('/api/memory/relations/' + edge.id).set(auth(other.token)).send({ version: 1 }).expect(404);
    await request(app.getHttpServer()).delete('/api/memory/relations/' + edge.id).set(auth(owner.token)).send({ version: 1 }).expect(200);
    await request(app.getHttpServer()).delete('/api/memory/relations/' + edge.id).set(auth(owner.token)).send({ version: 1 }).expect(200);
    expect(await service.contextCurrent(owner.userId, before)).toBe(false);
    expect((await service.context(owner.userId, '我的相机')).items.map(m => m.id)).toEqual([from.id]);
    const fresh = await relate(); expect(fresh.id).not.toBe(edge.id);
    const [history] = await pool.query<RowDataPacket[]>('SELECT status,version,active_identity FROM memory_relations WHERE id=UUID_TO_BIN(?)', [edge.id]);
    expect(history[0]).toMatchObject({ status: 'REVOKED', version: 2, active_identity: null });
  });
  it('endpoint correction revokes old relations and requires new current-version confirmation', async () => {
    const service = app.get(MemoryService), before = await service.context(owner.userId, '我的相机');
    const updated = await service.edit(owner.userId, to.id, { type: 'ASSET', title: '电池', content: '更正后的兼容型号', confirmed: true, version: 1 }); to.version = updated.version;
    expect(await service.contextCurrent(owner.userId, before)).toBe(false);
    const graph = (await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations`).set(auth(owner.token)).expect(200)).body;
    expect(graph.items).toEqual([]);
    expect((await service.context(owner.userId, '我的相机')).items.map(m => m.id)).toEqual([from.id]);
    await request(app.getHttpServer()).post(`/api/memory/${from.id}/relations`).set(auth(owner.token)).send({ ...body(), toVersion: 1 }).expect(409);
    await relate(); expect((await service.context(owner.userId, '我的相机')).relations![0].toVersion).toBe(2);
  });
  it('disabled usage excludes the graph; expiry and deletion remove all invalid connected data', async () => {
    const service = app.get(MemoryService), context = await service.context(owner.userId, '我的相机');
    await service.changeSettings(owner.userId, { enabled: false, version: 1 });
    expect(await service.contextCurrent(owner.userId, context)).toBe(false);
    expect((await service.context(owner.userId, '我的相机')).items).toEqual([]);
    // Disabled usage does not silently delete the user's confirmed graph.
    expect((await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations`).set(auth(owner.token)).expect(200)).body.items).toHaveLength(1);
    await service.changeSettings(owner.userId, { enabled: true, version: 2 });
    await pool.query('UPDATE personal_memories SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [to.id]);
    expect((await service.context(owner.userId, '我的相机')).items.map(m => m.id)).toEqual([from.id]);
    expect((await request(app.getHttpServer()).get(`/api/memory/${from.id}/relations`).set(auth(owner.token)).expect(200)).body.items).toEqual([]);
    await service.remove(owner.userId, to.id, 2);
    const [edges] = await pool.query<RowDataPacket[]>('SELECT status FROM memory_relations WHERE to_id=UUID_TO_BIN(?)', [to.id]);
    expect(edges.every(row => row.status === 'REVOKED')).toBe(true);
    expect((await service.reference(owner.userId, to.id, 2)).memory).toBeNull();
  });
});
