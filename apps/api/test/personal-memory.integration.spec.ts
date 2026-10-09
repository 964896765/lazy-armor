import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { MemoryService } from '../src/memory/memory.service';
import { AgentContextCompiler } from '../src/ai-adapter/agent-context-compiler.service';
import { AgentPlannerService, AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { GoalExecutionContextService } from '../src/agent/goal-execution-context.service';
import { type AgentModelAdapter, type AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';

describe.sequential('owned, consented personal memory and Planner consumption', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, settingsVersion: number, memoryId: string;
  const unique = randomUUID();
  const payload = { type: 'ASSET', title: '相机电池', content: '我的 Canon R10 使用 LP-E17 电池。', confirmed: true, requestId: randomUUID() };
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
    if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated test database required');
    ({ app, pool } = await bootP2App('memory-' + unique));
    owner = await register(app, unique + '@example.test', 'Memory owner');
    other = await register(app, 'other-' + unique + '@example.test', 'Memory other');
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  it('defaults to disabled and requires both usage consent and explicit save confirmation', async () => {
    expect((await request(app.getHttpServer()).get('/api/memory/settings').set(auth(owner.token)).expect(200)).body).toEqual({ enabled: false, version: 0 });
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send(payload).expect(409);
    const settings = (await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: true, version: 0 }).expect(200)).body;
    settingsVersion = settings.version;
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ ...payload, confirmed: false }).expect(400);
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ ...payload, sourceKind: 'TRUTH', confidence: 1 }).expect(400);
  });
  it('simultaneous save replay produces one identity and provenance; changed replay is rejected', async () => {
    const saved = await Promise.all([1, 2, 3].map(() => request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send(payload).expect(201)));
    expect(new Set(saved.map(res => res.body.id)).size).toBe(1); memoryId = saved[0].body.id;
    expect(saved[0].body).toMatchObject({ sourceKind: 'USER_INPUT', version: 1, type: 'ASSET' });
    expect(saved[0].body.confirmedAt).toBeTruthy();
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ ...payload, content: '另一个电池' }).expect(409);
  });
  it('owner isolation and relevance ranking prevent unrelated or cross-owner retrieval', async () => {
    await request(app.getHttpServer()).get('/api/memory/' + memoryId).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).patch('/api/memory/' + memoryId).set(auth(other.token)).send({ ...payload, requestId: undefined, version: 1 }).expect(404);
    expect((await app.get(MemoryService).context(other.userId, '相机电池')).items).toEqual([]);
    expect((await app.get(MemoryService).context(owner.userId, '我的相机买哪个电池')).items.map(m => m.id)).toEqual([memoryId]);
    expect((await app.get(MemoryService).context(owner.userId, '帮我看看物流')).items).toEqual([]);
  });
  it('memory is untrusted personal data, separated from Truth and policy; full content is absent from metadata', async () => {
    const memoryContext = await app.get(MemoryService).context(owner.userId, '相机电池');
    const compiled = new AgentContextCompiler().compile({ memoryContext, intent: '相机电池', domain: null, scenarios: [], truths: [], skills: [], capabilities: [], tools: [], evidence: [], untrustedSources: [] });
    const section = compiled.sections.find(s => s.title === 'PERSONAL MEMORY DATA')!;
    expect(section.kind).toBe('UNTRUSTED_SOURCE_CONTENT'); expect(section.content).toContain('LP-E17');
    const metadata = compiled.sections.find(s => s.kind === 'TRUSTED_RUNTIME_METADATA')!.content;
    expect(metadata).not.toContain('LP-E17'); expect(JSON.parse(metadata).truths).toEqual([]);
  });
  it('disable revokes current and future consumption without deleting or mutating the saved information', async () => {
    const context = await app.get(MemoryService).context(owner.userId, '相机电池');
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: false, version: settingsVersion }).expect(200);
    settingsVersion++;
    expect(await app.get(MemoryService).contextCurrent(owner.userId, context)).toBe(false);
    expect((await app.get(MemoryService).context(owner.userId, '相机电池')).items).toEqual([]);
    expect((await request(app.getHttpServer()).get('/api/memory/' + memoryId).set(auth(owner.token)).expect(200)).body.version).toBe(1);
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: true, version: settingsVersion - 1 }).expect(409);
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: true, version: settingsVersion }).expect(200); settingsVersion++;
  });
  it('production Planner with an isolated model delivers references and fences revocation during completion', async () => {
    let revoke = false, received: AgentModelRequest | undefined;
    const registered = app.get<AgentModelAdapter>(AGENT_MODEL);
    const model: AgentModelAdapter = { modelId: () => 'memory-contract-test-model', capability: () => registered.capability(),
      complete: async input => {
        received = input;
        if (revoke) await app.get(MemoryService).changeSettings(owner.userId, { enabled: false, version: settingsVersion });
        return { result: 'ANSWER', intentSummary: '根据个人信息比较电池', domain: null, scenarioKey: null, scenarioRevision: null,
          strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], draftDefinition: null,
          selectedSkillIds: [], toolRequirements: [], riskHints: [], explanation: '根据你提供的相机信息，可以比较兼容电池。', missingRequirements: [], warnings: [] };
      } };
    const planner = app.get(AgentPlannerService);
    // Swap only this isolated test instance; production model/config remain untouched.
    const originalModel = (planner as unknown as { model: AgentModelAdapter }).model;
    (planner as unknown as { model: AgentModelAdapter }).model = model;
    try {
      const memoryContext = await app.get(GoalExecutionContextService).memoryContext(owner.userId, '相机电池');
      const facts = { memoryContext, domain: null, scenarios: [], truths: [], capabilities: [], tools: [] };
      const result = await planner.planWithFacts('相机电池', facts, { userId: owner.userId, audit: false, workContext: 'TEMPORARY' });
      expect(result.result).toBe('ANSWER'); expect(result.memoryRefs).toEqual([{ id: memoryId, version: 1, settingsVersion }]);
      expect(result.understanding?.policy.executionAuthorized).toBe(false);
      expect(received!.context.sections.find(s => s.title === 'PERSONAL MEMORY DATA')?.content).toContain('LP-E17');
      revoke = true;
      const blocked = await planner.planWithFacts('相机电池', facts, { userId: owner.userId, audit: false, workContext: 'TEMPORARY' });
      expect(blocked).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['MEMORY_CONTEXT_CHANGED'] });
      expect(blocked.answer).toBeUndefined(); expect(blocked.memoryRefs).toBeUndefined();
      settingsVersion++;
    } finally { (planner as unknown as { model: AgentModelAdapter }).model = originalModel; }
    await app.get(MemoryService).changeSettings(owner.userId, { enabled: true, version: settingsVersion }); settingsVersion++;
  });
  it('edits invalidate the prior version and expiry excludes information from retrieval', async () => {
    const old = await app.get(MemoryService).context(owner.userId, '相机电池');
    const edited = await request(app.getHttpServer()).patch('/api/memory/' + memoryId).set(auth(owner.token)).send({ type: 'ASSET', title: payload.title, content: '更正后的相机电池信息', confirmed: true, version: 1 }).expect(200);
    expect(edited.body.version).toBe(2);
    expect(await app.get(MemoryService).contextCurrent(owner.userId, old)).toBe(false);
    await request(app.getHttpServer()).patch('/api/memory/' + memoryId).set(auth(owner.token)).send({ type: 'ASSET', title: payload.title, content: '旧版本修改', confirmed: true, version: 1 }).expect(409);
    const expiring = (await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ ...payload, requestId: randomUUID(), expiresAt: new Date(Date.now() + 100000).toISOString() }).expect(201)).body;
    // Isolated expiry fixture simulates elapsed time, never alters production memory.
    await pool.query('UPDATE personal_memories SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [expiring.id]);
    expect((await app.get(MemoryService).context(owner.userId, '相机电池')).items.some(m => m.id === expiring.id)).toBe(false);
    const oldExpiry = (await app.get(MemoryService).get(owner.userId, expiring.id)).expiresAt;
    const corrected = await app.get(MemoryService).edit(owner.userId, expiring.id, { type: 'ASSET', title: payload.title, content: '更正过期的电池记录', confirmed: true, version: 1 });
    expect(corrected.expiresAt).toBe(oldExpiry);
    expect((await app.get(MemoryService).context(owner.userId, '相机电池')).items.some(m => m.id === expiring.id)).toBe(false);
  });
  it('deletion erases stored personal text, is idempotent, and cannot resurrect the original request', async () => {
    const body = { version: 2 };
    await request(app.getHttpServer()).delete('/api/memory/' + memoryId).set(auth(other.token)).send(body).expect(404);
    await request(app.getHttpServer()).delete('/api/memory/' + memoryId).set(auth(owner.token)).send(body).expect(200);
    await request(app.getHttpServer()).delete('/api/memory/' + memoryId).set(auth(owner.token)).send(body).expect(200);
    await request(app.getHttpServer()).get('/api/memory/' + memoryId).set(auth(owner.token)).expect(404);
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send(payload).expect(409);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT title,content,status FROM personal_memories WHERE id=UUID_TO_BIN(?)', [memoryId]);
    expect(rows[0]).toMatchObject({ title: null, content: null, status: 'DELETED' });
    const [audits] = await pool.query<RowDataPacket[]>('SELECT before_snapshot_json,after_snapshot_json,change_summary FROM audit_logs WHERE resource_id=?', [memoryId]);
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audits)).not.toContain('LP-E17');
    expect(JSON.stringify(audits)).not.toContain('更正后的相机');
  });
});
