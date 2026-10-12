import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { consumerConversations, consumerMessages, type Database } from '@lazy-armor/database';
import { agentReportSchema, catalogHash, type AgentReport, type ReportDecisionInput } from '@lazy-armor/plan-schema';
import { eq } from 'drizzle-orm';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { DATABASE } from '../src/common/database.module';
import { MemoryService } from '../src/memory/memory.service';
import { ReportDecisionsService } from '../src/memory/report-decisions.service';
import { RequirementsService } from '../src/requirements/requirements.service';
import { AGENT_MODEL, AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import type { AgentModelAdapter } from '../src/ai-adapter/agent-model-adapter';

/** Report bodies here are isolated fixtures. Decisions follow the original owned Memory path. */
describe.sequential('V92 report-linked personal decisions', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, other: Session;
  const model: AgentModelAdapter = { modelId: () => 'v92-isolated-decision-planner',
    capability: () => ({ modelId: 'v92-isolated-decision-planner', supportsStructuredCompletion: true, supportsToolSelection: false, maxContextTokens: 4096 }),
    complete: async () => ({ result: 'ANSWER', intentSummary: '参考本人决定', domain: null, scenarioKey: null, scenarioRevision: null, strategyKey: null,
      requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null,
      explanation: '本人决定只是历史选择，后续仍需确认。', missingRequirements: [], warnings: [], riskHints: [] }) };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated SQL required');
    ({ app, pool } = await bootP2App('v92-decisions-' + randomUUID(), [{ token: AGENT_MODEL, value: model }])); db = app.get(DATABASE);
    owner = await register(app, randomUUID() + '@example.test', 'Decision owner'); other = await register(app, randomUUID() + '@example.test', 'Other');
    await app.get(MemoryService).changeSettings(owner.userId, { version: 0, enabled: true });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function fixture(stage: AgentReport['stage'] = 'COMPLETED') {
    const conversationId = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body.id;
    const messageId = randomUUID(), inputId = randomUUID(), requestId = randomUUID(), now = new Date();
    const brief = app.get(RequirementsService).compile({ goalId: conversationId, version: 1, messageId: inputId, intent: '湖北荆门城区开洗车店商业评估报告，预算15万元只作本次测算假设' });
    const report = agentReportSchema.parse({ version: 'agent-report.v1', revision: 4, stage, goal: brief.statement, conversationVersion: 1,
      requirementContext: { goalBrief: brief, userMessages: [{ messageId: inputId, quote: brief.statement }] }, sources: [], warnings: ['隔离报告，市场未经核实'],
      markdown: '这是隔离自动化报告正文，不能视为市场事实。', review: { issues: [], checkedAt: now.toISOString() }, updatedAt: now.toISOString() });
    await db.insert(consumerMessages).values([{ id: inputId, conversationId, requestId, role: 'user', content: brief.statement, contextRefs: [], createdAt: now },
      { id: messageId, conversationId, requestId, role: 'assistant', content: '报告夹具', contextRefs: [], structuredPayload: { result: 'ANSWER', report, goalBrief: brief }, createdAt: now }]);
    return { conversationId, messageId, report, inputId, brief };
  }
  const decisions = () => app.get(ReportDecisionsService), memories = () => app.get(MemoryService);
  const input = (f: Awaited<ReturnType<typeof fixture>>): ReportDecisionInput => ({ requestId: randomUUID(), conversationId: f.conversationId, messageId: f.messageId,
    reportRevision: f.report.revision, reportHash: catalogHash(f.report), decision: '先做荆门洗车店现场客流调查，再决定是否租赁门店', rationale: '当前客流和租金仍待核实',
    expectedOutcome: '取得三处候选店面的实际数据', confirmed: true });
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [owner.userId, owner.userId, owner.userId]);
    return rows[0];
  }
  it('only accepts an owned completed report, exact revision/hash and explicit user content', async () => {
    const f = await fixture(), body = input(f), server = app.getHttpServer();
    await request(server).get(`/api/memory/report-decisions/source?conversationId=${f.conversationId}&messageId=${f.messageId}`).set(auth(other.token)).expect(404);
    await request(server).post('/api/memory/report-decisions').set(auth(other.token)).send(body).expect(404);
    await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send({ ...body, confirmed: false }).expect(400);
    await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send({ ...body, reportRevision: 3 }).expect(409);
    await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send({ ...body, reportHash: '0'.repeat(64) }).expect(409);
    await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send({ ...body, sourceKind: 'TRUTH' }).expect(400);
    const pending = await fixture('REVIEWING'); await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send(input(pending)).expect(404);
    const incomplete = await fixture(); await db.update(consumerMessages).set({ structuredPayload: { result: 'ANSWER', report: { ...incomplete.report, review: undefined } } }).where(eq(consumerMessages.id, incomplete.messageId));
    await request(server).post('/api/memory/report-decisions').set(auth(owner.token)).send(input(incomplete)).expect(404);
  });
  it('saves one immutable request identity in original Memory; choices and expectations remain unverified personal input', async () => {
    const f = await fixture(), body = input(f), before = await counts();
    const source = (await request(app.getHttpServer()).get(`/api/memory/report-decisions/source?conversationId=${f.conversationId}&messageId=${f.messageId}`).set(auth(owner.token)).expect(200)).body;
    expect(source).toMatchObject({ reportRevision: 4, reportHash: catalogHash(f.report), goalId: f.brief.goalId, goalVersion: f.brief.version });
    const saved = await Promise.all([1, 2, 3].map(() => decisions().save(owner.userId, body)));
    expect(new Set(saved.map(memory => memory.id)).size).toBe(1);
    expect(saved[0]).toMatchObject({ type: 'DECISION', sourceKind: 'REPORT_DECISION_CONFIRMED', sourceRef: { kind: 'REPORT_DECISION', reportRevision: 4, goalVersion: 1 } });
    expect(saved[0].content).toContain('预期（尚未验证）'); expect(saved[0].content).toContain('不代表市场事实');
    await expect(decisions().save(owner.userId, { ...body, decision: 'Changed replay' })).rejects.toThrow('MEMORY_REQUEST_IDENTITY_CHANGED');
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ type: 'DECISION', title: 'Forgery', content: 'Forgery', confirmed: true, requestId: `report-decision:${randomUUID()}` }).expect(400);
    const ref = await memories().reference(owner.userId, saved[0].id, 1);
    expect(ref).toMatchObject({ state: 'CURRENT', source: { available: true, conversationId: f.conversationId, messageId: f.messageId, reportRevision: 4 } });
    expect((await memories().context(owner.userId, '荆门洗车店现场客流调查')).items.some(memory => memory.id === saved[0].id)).toBe(true);
    expect(await counts()).toEqual(before);
  });
  it('owner-scoped decision history paginates and does not mix reports or deleted memories', async () => {
    const f = await fixture(); const a = await decisions().save(owner.userId, input(f)), b = await decisions().save(owner.userId, input(f));
    const another = await fixture(); await decisions().save(owner.userId, input(another));
    const first = await decisions().list(owner.userId, f.conversationId, f.messageId, { limit: 1 });
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = await decisions().list(owner.userId, f.conversationId, f.messageId, { limit: 1, cursor: first.nextCursor! });
    expect(new Set([first.items[0].id, second.items[0].id])).toEqual(new Set([a.id, b.id]));
    await memories().remove(owner.userId, a.id, 1);
    expect((await decisions().list(owner.userId, f.conversationId, f.messageId, { limit: 20 })).items.map(item => item.id)).toEqual([b.id]);
    await expect(decisions().list(other.userId, f.conversationId, f.messageId, { limit: 20 })).rejects.toThrow('Report decision source unavailable');
  });
  it('report revision or content changes block old references and pending save', async () => {
    const f = await fixture(), body = input(f), memory = await decisions().save(owner.userId, body), snapshot = await memories().context(owner.userId, '荆门洗车店现场客流调查');
    await db.update(consumerMessages).set({ structuredPayload: { result: 'ANSWER', report: { ...f.report, markdown: '同一版本正文已经变化' }, goalBrief: f.brief } }).where(eq(consumerMessages.id, f.messageId));
    expect((await memories().reference(owner.userId, memory.id, 1)).state).toBe('SOURCE_UNAVAILABLE');
    expect((await memories().context(owner.userId, '荆门洗车店现场客流调查')).items.some(item => item.id === memory.id)).toBe(false);
    expect(await memories().contextCurrent(owner.userId, snapshot)).toBe(false);
    await expect(decisions().save(owner.userId, { ...body, requestId: randomUUID() })).rejects.toThrow('REPORT_DECISION_SOURCE_CHANGED');
  });
  it('deleting the report conversation after Planner validation fences final publication', async () => {
    const f = await fixture(), memory = await decisions().save(owner.userId, input(f));
    const planner = app.get(AgentPlannerService), original = planner.plan;
    planner.plan = async (...args) => {
      const result = await original.apply(planner, args);
      expect(result.memoryRefs?.some(ref => ref.id === memory.id)).toBe(true);
      await db.update(consumerConversations).set({ deletedAt: new Date() }).where(eq(consumerConversations.id, f.conversationId));
      return result;
    };
    try {
      const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
      const response = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
        .send({ version: 0, requestId: randomUUID(), content: '参考荆门洗车店现场客流调查的决定' }).expect(201)).body;
      expect(response.messages.at(-1).structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['MEMORY_CONTEXT_CHANGED'] });
    } finally { planner.plan = original; }
    expect((await memories().reference(owner.userId, memory.id, 1)).source.available).toBe(false);
  });
  it('disable and personal corrections reuse original Memory controls', async () => {
    const f = await fixture(), body = input(f), memory = await decisions().save(owner.userId, body);
    await memories().changeSettings(owner.userId, { version: 1, enabled: false });
    await expect(decisions().save(owner.userId, { ...body, requestId: randomUUID() })).rejects.toThrow('MEMORY_USAGE_DISABLED');
    expect((await memories().context(owner.userId, '荆门洗车店')).items).toEqual([]);
    await memories().changeSettings(owner.userId, { version: 2, enabled: true });
    const edited = await memories().edit(owner.userId, memory.id, { version: 1, type: 'DECISION', title: '更正后的决定', content: '我要先学习再创业。', confirmed: true });
    expect(edited).toMatchObject({ sourceKind: 'USER_INPUT', sourceRef: null, version: 2 });
  });
});
