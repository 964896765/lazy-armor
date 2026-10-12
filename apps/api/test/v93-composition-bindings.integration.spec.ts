import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { consumerMessages, type Database } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { DATABASE } from '../src/common/database.module';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FixtureAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ConnectionsService } from '../src/connections/connections.service';
import { ConsumerService } from '../src/consumer/consumer.service';
import { WEB_READ } from '../src/connectors/public-web.connector';

describe.sequential('V93 report resources bind original read authority', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, model: ReportModelService;
  const pageUrl = 'https://www.example.gov.cn/research.html', excerpt = '仅用于隔离测试的公开原文，没有当地市场实测数据。'.repeat(30);
  const basePlan = { title: '学习报告', prompt: '根据既有目标和明确假设生成完整研究报告。'.repeat(12), sections: ['目标', '条件', '风险', '研究报告'], assumptions: ['效果待核实'], researchQuestions: ['学习方法公开原文'], connectionIds: [] as string[], webQueries: [] as string[], financialModel: null };
  const markdown = basePlan.sections.join('\n') + '\n[S1]\n' + '资料为来源响应，未取得的事实需列为假设与待核实项。'.repeat(45);
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated SQL required');
    ({ app, pool } = await bootP2App('v93-bindings-' + randomUUID(), [{ token: AGENT_MODEL, value: new FixtureAgentModel() }]));
    db = app.get(DATABASE); model = app.get(ReportModelService);
    vi.spyOn(model, 'runMethod').mockImplementation(async (_userId, _goal, _plan, _composition, _method, _inputs, sources) => ({ value: { outputs: { report: '依据本次公开原文形成的研究产物。' }, sourceIds: sources.map(source => source.id) }, modelId: 'isolated' }));
    vi.spyOn(model, 'plan'); vi.spyOn(model, 'write').mockResolvedValue({ value: { markdown }, modelId: 'isolated' });
    vi.spyOn(model, 'review').mockResolvedValue({ value: { issues: [] }, modelId: 'isolated' });
    vi.spyOn(model, 'chooseWebSources').mockResolvedValue({ value: { urls: [pageUrl] }, modelId: 'isolated' });
    const connector = app.get(ConnectorRegistry).get('public_web_research');
    vi.spyOn(connector, 'validateConnection').mockImplementation(async () => ({ status: 'healthy', checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 600000).toISOString() }));
    vi.spyOn(connector, 'read').mockImplementation(async input => input.input.mode === 'search'
      ? { ok: true, data: { query: input.input.query, candidates: [{ title: '公开原文', url: pageUrl, method: 'SEARCH_RESULT' }], warnings: [] } }
      : { ok: true, data: { page: { title: '公开原文', url: pageUrl, publishedAt: null, excerpt, sha256: createHash('sha256').update(excerpt).digest('hex'), retrievedAt: new Date().toISOString(), truncated: false, verification: 'SOURCE_RESPONSE_ONLY' } } });
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function connection(owner: Session, name: string, granted = true) {
    const row = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: 'public_web_research', externalAccountName: name, credentials: { entryUrls: 'https://www.example.gov.cn/' } }).expect(201)).body;
    if (granted) await grant(owner, row.id, true);
    return row;
  }
  async function grant(owner: Session, id: string, granted: boolean) {
    await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: WEB_READ, granted }] }).expect(200);
  }
  async function fixture(count = 1) {
    const owner = await register(app, randomUUID() + '@example.test', '隔离资源用户');
    const connections = [];
    for (let index = 0; index < count; index++) connections.push(await connection(owner, '公开来源' + index));
    const methods = app.get(SkillRepositoriesService);
    const input = { type: 'object', additionalProperties: false, properties: { goal: { type: 'string' } }, required: ['goal'] };
    const output = { type: 'object', additionalProperties: false, properties: { report: { type: 'string' } }, required: ['report'] };
    const imported = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '隔离公开研究', sourceType: 'USER', entries: [{ name: 'PublicResearch', version: '1.0.0', domain: 'learning', description: '公开来源研究', input, output, requiredCapabilities: [WEB_READ], permission: ['READ'], risk: 'R0', verification: ['STRUCTURED_EVIDENCE'], instruction: '依据所选公开原文提供学习研究报告，不改变权限或声称个人事实。' }] });
    const repository = await methods.change(owner.userId, imported.id, 1, true), entry = repository.entries[0];
    const ref = { repositoryId: repository.id, repositoryVersion: repository.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash };
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', methodRefs: [ref] }).expect(201)).body;
    // First report is a completed isolated source message, not personal or runtime evidence.
    vi.mocked(model.plan).mockResolvedValueOnce({ value: basePlan, modelId: 'isolated' });
    const conversation = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ content: '生成学习目标研究报告，预算500元', version: 0, requestId: randomUUID() }).expect(201)).body;
    const first = conversation.messages.find((row: { role: string }) => row.role === 'assistant');
    await app.get(ReportGenerationService).process(first.id);
    const graph = { version: conversation.version, links: [], goalBindings: [{ methodId: entry.id, inputField: 'goal', goalField: 'goal' }], deliveries: [{ methodId: entry.id, outputField: 'report', label: '研究报告' }] };
    const preview = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-preview`).set(auth(owner.token)).send({ graph }).expect(201)).body;
    expect(preview.state).toBe('STRUCTURE_VALID');
    const selection = { graph, basis: { goalBriefRef: preview.goalBriefRef, methodRefs: preview.methodRefs, sourceMessageRefs: preview.sourceMessageRefs } };
    return { owner, connections, conversation, ref, selection, endpoint: `/api/conversations/${created.id}/composition-authoring` };
  }
  async function accepted(flow: Awaited<ReturnType<typeof fixture>>, chosen?: string) {
    const requestId = randomUUID();
    const selection = { ...flow.selection, ...(chosen ? { resourceSelections: [{ methodId: flow.ref.entryId, capabilityKey: WEB_READ, connectionId: chosen }] } : {}) };
    const row = (await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId, selection }).expect(201)).body;
    const job = row.authoringJobs.find((value: { requestId: string }) => value.requestId === requestId);
    await app.get(AuthoringJobsService).process(job.jobId);
    const current = await app.get(ConsumerService).conversation(flow.owner.userId, flow.conversation.id);
    const message = current.messages.find(value => value.requestId === requestId && value.role === 'assistant')!;
    expect(message.structuredPayload?.report).toMatchObject({ stage: 'QUEUED' });
    return { message, requestId, selection };
  }
  async function report(flow: Awaited<ReturnType<typeof fixture>>, messageId: string) {
    await app.get(ReportGenerationService).process(messageId);
    const current = await app.get(ConsumerService).conversation(flow.owner.userId, flow.conversation.id);
    return current.messages.find(row => row.id === messageId)!.structuredPayload!.report as any;
  }
  it('shows owned ready choices, rejects ambiguity, pins an explicit source and excludes other connected sources from the model and reads', async () => {
    const flow = await fixture(2);
    const options = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}/composition-resources`).set(auth(flow.owner.token)).expect(200)).body;
    expect(options.requirements[0].candidates.map((row: { connectionId: string }) => row.connectionId).sort()).toEqual(flow.connections.map(row => row.id).sort());
    const blocked = (await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: randomUUID(), selection: flow.selection }).expect(409)).body;
    expect(blocked.message).toBe('COMPOSITION_RESOURCE_SELECTION_REQUIRED');
    const chosen = flow.connections[1].id, result = await accepted(flow, chosen);
    vi.mocked(model.plan).mockResolvedValueOnce({ value: { ...basePlan, connectionIds: [chosen], webQueries: ['学习方法 原文'] }, modelId: 'isolated' });
    const invoke = vi.spyOn(app.get(ConnectionsService), 'invokeConsumerRead');
    try {
      const final = await report(flow, result.message.id);
      expect(final.stage).toBe('COMPLETED');
      expect(vi.mocked(model.plan).mock.calls.at(-1)?.[2].map(row => row.id)).toEqual([chosen]);
      expect(final.sources[0]).toMatchObject({ connectionId: chosen, capabilityKey: WEB_READ });
      expect(invoke.mock.calls.every(call => call[1] === chosen && call[3]?.authorityHash === final.requirementContext.composition.snapshot.reportReadBindings[0].authorityHash)).toBe(true);
      const replay = (await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: result.requestId, selection: result.selection }).expect(201)).body;
      expect(replay.authoringJobs.filter((job: { requestId: string }) => job.requestId === result.requestId)).toHaveLength(1);
      await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: result.requestId, selection: { ...result.selection, resourceSelections: [{ methodId: flow.ref.entryId, capabilityKey: WEB_READ, connectionId: flow.connections[0].id }] } }).expect(409);
    } finally { invoke.mockRestore(); }
  });
  it('does not fall back after revoke/regrant before queued generation', async () => {
    const flow = await fixture(2), result = await accepted(flow, flow.connections[0].id), calls = vi.mocked(model.plan).mock.calls.length;
    await grant(flow.owner, flow.connections[0].id, false); await grant(flow.owner, flow.connections[0].id, true);
    const final = await report(flow, result.message.id);
    expect(final).toMatchObject({ stage: 'FAILED', errorCode: 'COMPOSITION_RESOURCE_AUTHORITY_CHANGED' });
    expect(vi.mocked(model.plan).mock.calls.length).toBe(calls);
  });
  it('rejects another owner, an ungranted resource, and fabricated authority without admission', async () => {
    const flow = await fixture(), other = await register(app, randomUUID() + '@example.test', '其他隔离用户'), foreign = await connection(other, '其他来源'), ungranted = await connection(flow.owner, '未授权来源', false);
    await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}/composition-resources`).set(auth(other.token)).expect(404);
    for (const connectionId of [foreign.id, ungranted.id]) await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: randomUUID(), selection: { ...flow.selection, resourceSelections: [{ methodId: flow.ref.entryId, capabilityKey: WEB_READ, connectionId }] } }).expect(409);
    await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: randomUUID(), selection: { ...flow.selection, resourceSelections: [{ methodId: flow.ref.entryId, capabilityKey: WEB_READ, connectionId: flow.connections[0].id, authorityHash: 'a'.repeat(64) }] } }).expect(400);
  });
  it.each(['omit', 'replace', 'no-original'] as const)('does not publish a report that tries to %s its required bound source', async kind => {
    const flow = await fixture(2), chosen = flow.connections[0].id, result = await accepted(flow, chosen);
    vi.mocked(model.plan).mockResolvedValueOnce({ value: { ...basePlan, connectionIds: kind === 'omit' ? [] : [kind === 'replace' ? flow.connections[1].id : chosen], webQueries: ['学习方法 原文'] }, modelId: 'isolated' });
    if (kind === 'no-original') vi.mocked(model.chooseWebSources).mockResolvedValueOnce({ value: { urls: [] }, modelId: 'isolated' });
    const final = await report(flow, result.message.id);
    expect(final.stage).toBe('FAILED');
    expect(final.errorCode).toBe(kind === 'omit' ? 'REPORT_BOUND_SOURCE_REQUIRED' : kind === 'replace' ? 'REPORT_SOURCE_INVALID' : 'REPORT_WEB_SOURCE_REQUIRED');
  });
  it('rechecks the original authority in admission even after binding selection succeeded', async () => {
    const flow = await fixture(), consumer = app.get(ConsumerService), original = consumer.message.bind(consumer);
    const spy = vi.spyOn(consumer, 'message').mockImplementationOnce(async (...args) => { await grant(flow.owner, flow.connections[0].id, false); return original(...args); });
    try {
      const result = (await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId: randomUUID(), selection: flow.selection }).expect(409)).body;
      expect(result.message).toBe('COMPOSITION_RESOURCE_AUTHORITY_CHANGED');
    } finally { spy.mockRestore(); }
  });
  it('rejects permission withdrawal during writing before final publication', async () => {
    const flow = await fixture(), result = await accepted(flow);
    vi.mocked(model.plan).mockResolvedValueOnce({ value: { ...basePlan, connectionIds: [flow.connections[0].id], webQueries: ['学习方法 原文'] }, modelId: 'isolated' });
    vi.mocked(model.write).mockImplementationOnce(async () => { await grant(flow.owner, flow.connections[0].id, false); return { value: { markdown }, modelId: 'isolated' }; });
    expect(await report(flow, result.message.id)).toMatchObject({ stage: 'FAILED', errorCode: 'COMPOSITION_RESOURCE_AUTHORITY_CHANGED' });
  });
  it('preserves zero Plan, Execution and Truth side effects', async () => {
    const flow = await fixture(), result = await accepted(flow);
    vi.mocked(model.plan).mockResolvedValueOnce({ value: { ...basePlan, connectionIds: [flow.connections[0].id], webQueries: ['学习方法 原文'] }, modelId: 'isolated' });
    expect((await report(flow, result.message.id)).stage).toBe('COMPLETED');
    const [rows] = await pool.query('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [flow.owner.userId, flow.owner.userId, flow.owner.userId]);
    expect((rows as any[])[0]).toMatchObject({ plans: 0, executions: 0, truths: 0 });
  });
  it('records a terminal contextual failure if pinned authority is withdrawn before authoring, without retrying or calling the model', async () => {
    const flow = await fixture(), requestId = randomUUID();
    const accepted = (await request(app.getHttpServer()).post(flow.endpoint).set(auth(flow.owner.token)).send({ requestId, selection: flow.selection }).expect(201)).body;
    const job = accepted.authoringJobs.find((row: { requestId: string }) => row.requestId === requestId);
    const calls = vi.mocked(model.plan).mock.calls.length;
    await grant(flow.owner, flow.connections[0].id, false); await grant(flow.owner, flow.connections[0].id, true);
    await app.get(AuthoringJobsService).process(job.jobId);
    const final = await app.get(ConsumerService).conversation(flow.owner.userId, flow.conversation.id);
    expect(final.messages.find(row => row.requestId === requestId && row.role === 'assistant')!.structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['COMPOSITION_RESOURCE_AUTHORITY_CHANGED'] });
    expect(final.authoringJobs.find(row => row.jobId === job.jobId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(vi.mocked(model.plan).mock.calls.length).toBe(calls);
  });

  it('rejects changed website configuration even when permission remains granted', async () => {
    const flow = await fixture(), result = await accepted(flow), calls = vi.mocked(model.plan).mock.calls.length;
    await request(app.getHttpServer()).post(`/api/connections/${flow.connections[0].id}/credentials/rotate`).set(auth(flow.owner.token)).send({ credentials: { entryUrls: 'https://www.example.gov.cn/changed/' } }).expect(201);
    expect(await report(flow, result.message.id)).toMatchObject({ stage: 'FAILED', errorCode: 'COMPOSITION_RESOURCE_AUTHORITY_CHANGED' });
    expect(vi.mocked(model.plan).mock.calls.length).toBe(calls);
  });

  it('resumes saved research on the original source when another ready source appears', async () => {
    const flow = await fixture(), result = await accepted(flow);
    vi.mocked(model.plan).mockResolvedValueOnce({ value: { ...basePlan, connectionIds: [flow.connections[0].id], webQueries: ['学习方法 原文'] }, modelId: 'isolated' });
    vi.mocked(model.write).mockRejectedValueOnce(new Error('REPORT_STATE_CHANGED'));
    const paused = await report(flow, result.message.id);
    expect(paused.stage).toBe('WRITING');
    expect(paused.sources[0].connectionId).toBe(flow.connections[0].id);
    const reads = vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length;
    const plans = vi.mocked(model.plan).mock.calls.length;
    await connection(flow.owner, '后续新增来源');
    const resumed = await report(flow, result.message.id);
    expect(resumed.stage).toBe('COMPLETED');
    expect(resumed.requirementContext.composition.snapshot.reportReadBindings).toEqual(paused.requirementContext.composition.snapshot.reportReadBindings);
    expect(vi.mocked(model.plan).mock.calls.length).toBe(plans);
    expect(vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length).toBe(reads);
  });
  it('rejects a saved plan modified to use an unbound source before recovery can read it', async () => {
    const flow = await fixture(2), result = await accepted(flow, flow.connections[0].id);
    const payload = result.message.structuredPayload!;
    const tampered = { ...(payload.report as any), plan: { ...basePlan, connectionIds: [flow.connections[1].id], webQueries: ['学习方法 原文'] }, stage: 'RESEARCHING' };
    await db.update(consumerMessages).set({ structuredPayload: { ...payload, report: tampered } }).where(eq(consumerMessages.id, result.message.id));
    const reads = vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length;
    expect(await report(flow, result.message.id)).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_SOURCE_OUTSIDE_BINDING' });
    expect(vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length).toBe(reads);
  });

});
