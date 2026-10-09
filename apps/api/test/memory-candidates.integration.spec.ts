import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { eq } from 'drizzle-orm';
import { consumerMessages, type Database } from '@lazy-armor/database';
import type { MemoryCandidate, MemorySuggestion } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AGENT_MODEL, AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import type { AgentModelAdapter } from '../src/ai-adapter/agent-model-adapter';
import { MemoryService } from '../src/memory/memory.service';
import { DATABASE } from '../src/common/database.module';

/** Production conversation/planner/confirmation paths with an isolated deterministic model, never real-phone evidence. */
describe.sequential('conversation memory suggestions remain distinct from confirmed memory', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, other: Session, settingsVersion = 1;
  let suggestions: MemorySuggestion[] = [], duringCompletion: (() => Promise<void>) | undefined;
  const model: AgentModelAdapter = { modelId: () => 'isolated-memory-extractor',
    capability: () => ({ modelId: 'isolated-memory-extractor', supportsStructuredCompletion: true, supportsToolSelection: false, maxContextTokens: 4096 }),
    complete: async () => { await duringCompletion?.(); return { result: 'ANSWER', intentSummary: '核对你提供的信息', domain: null,
      scenarioKey: null, scenarioRevision: null, strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [],
      selectedSkillIds: [], toolRequirements: [], draftDefinition: null, explanation: '这是你提供的个人信息，可以核对后决定是否保存。', missingRequirements: [], warnings: [], riskHints: [], memorySuggestions: suggestions }; } };
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test'; process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
    if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated test database required');
    ({ app, pool } = await bootP2App('memory-candidates-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
    db = app.get(DATABASE); owner = await register(app, randomUUID() + '@example.test', 'Memory extraction owner'); other = await register(app, randomUUID() + '@example.test', 'Other');
    await app.get(MemoryService).changeSettings(owner.userId, { version: 0, enabled: true });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function conversation(content = '我有 Canon R10 相机，使用 LP-E17 电池。') {
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    const requestId = randomUUID();
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ version: created.version, requestId, content }).expect(201)).body;
    const candidates = (await request(app.getHttpServer()).get(`/api/memory/candidates?conversationId=${created.id}`).set(auth(owner.token)).expect(200)).body.items as MemoryCandidate[];
    return { result, candidates, requestId, content };
  }
  const suggestion: MemorySuggestion = { type: 'ASSET', title: '相机与电池', quote: '我有 Canon R10 相机，使用 LP-E17 电池。' };
  const confirmInput = (candidate: MemoryCandidate) => ({ type: candidate.type, title: candidate.title, content: candidate.quote, version: candidate.version, confirmed: true });

  it('extracts exact current-user quotes only, rejects invented/attachment text and deduplicates candidates', async () => {
    suggestions = [suggestion, suggestion, { type: 'ASSET', title: '编造', quote: '我拥有另一台相机。' }];
    const f = await conversation();
    expect(f.candidates).toHaveLength(1); expect(f.candidates[0]).toMatchObject({ status: 'PENDING', version: 1, quote: suggestion.quote });
    expect(f.result.messages.at(-1).structuredPayload.memoryCandidateProposal).toBeUndefined();
    expect((await app.get(MemoryService).context(owner.userId, '相机电池')).items).toEqual([]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM personal_memories WHERE user_id=UUID_TO_BIN(?)) memories,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [owner.userId, owner.userId, owner.userId]);
    expect(rows[0]).toMatchObject({ memories: 0, executions: 0, truths: 0 });
    await request(app.getHttpServer()).post(`/api/conversations/${f.result.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: f.requestId, content: f.content }).expect(201);
    expect((await request(app.getHttpServer()).get(`/api/memory/candidates?conversationId=${f.result.id}`).set(auth(owner.token)).expect(200)).body.items).toHaveLength(1);
  });
  it('requires explicit owner confirmation, then freezes one confirmed identity under concurrent replay', async () => {
    suggestions = [suggestion]; const f = await conversation(), candidate = f.candidates[0], body = confirmInput(candidate);
    await request(app.getHttpServer()).get(`/api/memory/candidates/${candidate.id}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/memory/candidates?conversationId=${f.result.id}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(other.token)).send(body).expect(404);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send({ ...body, confirmed: false }).expect(400);
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ ...body, version: undefined, requestId: `memory-candidate:${candidate.id}` }).expect(400);
    const results = await Promise.all([1, 2, 3].map(() => request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send(body).expect(201)));
    expect(new Set(results.map(r => r.body.memoryId)).size).toBe(1);
    const memoryId = results[0].body.memoryId;
    const memory = await app.get(MemoryService).get(owner.userId, memoryId);
    expect(memory).toMatchObject({ sourceKind: 'CONVERSATION_CONFIRMED', version: 1, content: suggestion.quote, sourceRef: { candidateId: candidate.id, conversationId: f.result.id, messageId: candidate.sourceMessageId } });
    const completed = (await request(app.getHttpServer()).get(`/api/memory/candidates/${candidate.id}`).set(auth(owner.token)).expect(200)).body;
    expect(completed).toMatchObject({ status: 'CONFIRMED', version: 2, quote: null, title: null, confirmedMemoryVersion: 1 });
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send({ ...body, content: '更改后的重放' }).expect(409);
    const reference = (await request(app.getHttpServer()).get(`/api/memory/${memoryId}/reference?version=1`).set(auth(owner.token)).expect(200)).body;
    expect(reference).toMatchObject({ state: 'CURRENT', source: { available: true, content: f.content } });
    await db.update(consumerMessages).set({ content: '来源被改写的隔离测试' }).where(eq(consumerMessages.id, candidate.sourceMessageId));
    expect((await app.get(MemoryService).reference(owner.userId, memoryId, 1)).source).toMatchObject({ available: false });
    await db.update(consumerMessages).set({ content: f.content }).where(eq(consumerMessages.id, candidate.sourceMessageId));
    await request(app.getHttpServer()).get(`/api/memory/${memoryId}/reference?version=1`).set(auth(other.token)).expect(404);
    await app.get(MemoryService).edit(owner.userId, memoryId, { type: 'ASSET', title: '相机', content: '我已更正电池信息', confirmed: true, version: 1 });
    expect((await app.get(MemoryService).reference(owner.userId, memoryId, 1)).state).toBe('CHANGED');
    expect((await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send(body).expect(201)).body.confirmedMemoryVersion).toBe(1);
    await app.get(MemoryService).remove(owner.userId, memoryId, 2);
    const deleted = await app.get(MemoryService).reference(owner.userId, memoryId, 1);
    expect(deleted).toMatchObject({ state: 'DELETED', memory: null, source: { available: false } }); expect(deleted.source.content).toBeUndefined();
  });
  it('allows review corrections while retaining actual user-message provenance; ignoring a candidate never saves it', async () => {
    suggestions = [suggestion]; const f = await conversation(), candidate = f.candidates[0];
    const corrected = { ...confirmInput(candidate), title: '我确认的相机', content: '经我核对，电池型号需要进一步检查。' };
    const result = (await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send(corrected).expect(201)).body;
    expect((await app.get(MemoryService).get(owner.userId, result.memoryId)).content).toBe(corrected.content);
    const ignored = (await conversation()).candidates[0];
    await request(app.getHttpServer()).post(`/api/memory/candidates/${ignored.id}/dismiss`).set(auth(owner.token)).send({ version: 1 }).expect(201);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${ignored.id}/dismiss`).set(auth(owner.token)).send({ version: 1 }).expect(201);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${ignored.id}/confirm`).set(auth(owner.token)).send(confirmInput(ignored)).expect(409);
    expect((await request(app.getHttpServer()).get(`/api/memory/candidates/${ignored.id}`).set(auth(owner.token)).expect(200)).body).toMatchObject({ status: 'DISMISSED', quote: null, memoryId: null });
  });
  it('source mutation and conversation deletion invalidate pending suggestions', async () => {
    const f = await conversation(), candidate = f.candidates[0];
    // Isolated corruption fixture verifies source fencing; never modifies a production message.
    await db.update(consumerMessages).set({ content: '被修改的来源' }).where(eq(consumerMessages.id, candidate.sourceMessageId));
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send(confirmInput(candidate)).expect(409);
    const next = await conversation(), nextCandidate = next.candidates[0];
    await request(app.getHttpServer()).post(`/api/conversations/${next.result.id}/history`).set(auth(owner.token)).send({ action: 'DELETE', version: next.result.version }).expect(201);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${nextCandidate.id}/confirm`).set(auth(owner.token)).send(confirmInput(nextCandidate)).expect(404);
  });
  it('disable purges pending candidate text and enable never revives old proposals', async () => {
    const f = await conversation(), candidate = f.candidates[0];
    await app.get(MemoryService).changeSettings(owner.userId, { enabled: false, version: settingsVersion++ });
    const invalid = (await request(app.getHttpServer()).get(`/api/memory/candidates/${candidate.id}`).set(auth(owner.token)).expect(200)).body;
    expect(invalid).toMatchObject({ status: 'UNAVAILABLE', quote: null, title: null });
    const disabled = await conversation(); expect(disabled.candidates).toHaveLength(0);
    await app.get(MemoryService).changeSettings(owner.userId, { enabled: true, version: settingsVersion++ });
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate.id}/confirm`).set(auth(owner.token)).send(confirmInput(candidate)).expect(409);
  });
  it('revocation during model completion blocks extraction even with no retrieved memory', async () => {
    duringCompletion = async () => { await app.get(MemoryService).changeSettings(owner.userId, { enabled: false, version: settingsVersion++ }); };
    try {
      const f = await conversation('我有 Canon R10 相机，使用 LP-E17 电池。');
      expect(f.candidates).toEqual([]);
      expect(f.result.messages.at(-1).structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['MEMORY_CONTEXT_CHANGED'] });
    } finally { duringCompletion = undefined; }
    await app.get(MemoryService).changeSettings(owner.userId, { enabled: true, version: settingsVersion++ });
  });
  it('final conversation publication fences a correction after Planner validation but before message commit', async () => {
    const memory = await app.get(MemoryService).create(owner.userId, { type: 'ASSET', title: '相机电池', content: '我使用 Canon R10 相机。', confirmed: true, requestId: randomUUID() });
    const planner = app.get(AgentPlannerService), original = planner.plan;
    planner.plan = async (...args) => {
      const result = await original.apply(planner, args);
      expect(result.memoryRefs?.some(ref => ref.id === memory.id)).toBe(true);
      await app.get(MemoryService).edit(owner.userId, memory.id, { type: 'ASSET', title: '相机', content: '我已更换了相机', confirmed: true, version: 1 });
      return result;
    };
    try {
      const f = await conversation();
      expect(f.result.status).toBe('ACTIVE');
      expect(f.result.messages.at(-1).structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['MEMORY_CONTEXT_CHANGED'] });
      expect(f.result.messages.at(-1).structuredPayload.memoryRefs).toBeUndefined();
      expect(f.candidates).toEqual([]);
      expect(f.result.messages[0].content).toBe(f.content);
    } finally { planner.plan = original; }
  });
});
