import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { authoringJobs, consumerMessages, type Database } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { compositionAuthoringSnapshotSchema, type SkillCapability, type SkillMethodRef } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { DATABASE } from '../src/common/database.module';
import { AGENT_MODEL, AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import { FixtureAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { GoalResourceMatchService } from '../src/consumer/goal-resource-match.service';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import { ConsumerService } from '../src/consumer/consumer.service';

describe.sequential('V93 reviewed composition joins durable planning, without execution authority', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, other: Session;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated SQL required');
    ({ app, pool } = await bootP2App('v93-authoring-' + randomUUID(), [{ token: AGENT_MODEL, value: new FixtureAgentModel() }]));
    db = app.get(DATABASE); owner = await register(app, randomUUID() + '@example.test', 'Composition owner');
    other = await register(app, randomUUID() + '@example.test', 'Other owner');
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  const ports = (field: string) => ({ type: 'object', additionalProperties: false, properties: { [field]: { type: 'string' } }, required: [field] });
  const method = (name: string, input: string, output: string): SkillCapability => ({ name, version: '1.0.0', domain: 'general', description: 'Isolated declarative guidance',
    input: ports(input), output: ports(output), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '仅供规划参考，不执行工具或写入 Truth。' });
  async function fixture(mode: 'PLAN' | 'TEMPORARY' = 'TEMPORARY', reportGoal = false) {
    const methods = app.get(SkillRepositoriesService);
    const imported = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '隔离规划方法', sourceType: 'USER',
      entries: [method('ReportMethod', 'research', 'report'), method('ResearchMethod', 'goal', 'research')] });
    const repository = await methods.change(owner.userId, imported.id, 1, true);
    const refs: SkillMethodRef[] = ['ReportMethod', 'ResearchMethod'].map(name => { const entry = repository.entries.find(row => row.manifest.name === name)!;
      return { repositoryId: repository.id, repositoryVersion: repository.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }; });
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode, methodRefs: refs }).expect(201)).body;
    const conversation = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: randomUUID(), content: reportGoal ? '生成本周学习目标分析报告，预算500元' : '帮我整理本周学习目标，预算500元' }).expect(201)).body;
    if (reportGoal) await app.get(ReportGenerationService).process(conversation.messages.find((row: { role: string }) => row.role === 'assistant').id);
    const graph = { version: conversation.version, links: [{ fromMethodId: refs[1].entryId, outputField: 'research', toMethodId: refs[0].entryId, inputField: 'research' }],
      goalBindings: [{ methodId: refs[1].entryId, inputField: 'goal', goalField: 'goal' }], deliveries: [{ methodId: refs[0].entryId, outputField: 'report', label: '学习建议' }] };
    const preview = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-preview`).set(auth(owner.token)).send({ graph }).expect(201)).body;
    expect(preview.state).toBe('STRUCTURE_VALID');
    const selection = { graph, basis: { goalBriefRef: preview.goalBriefRef, methodRefs: preview.methodRefs, sourceMessageRefs: preview.sourceMessageRefs } };
    return { conversation, refs, repository, selection, endpoint: `/api/conversations/${created.id}/composition-authoring` };
  }
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [owner.userId, owner.userId, owner.userId]);
    return rows[0];
  }
  async function submit(f: Awaited<ReturnType<typeof fixture>>, requestId = randomUUID()) {
    const conversation = (await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId, selection: f.selection }).expect(201)).body;
    const job = conversation.authoringJobs.find((row: { requestId: string }) => row.requestId === requestId);
    expect(job).toMatchObject({ status: 'QUEUED', executionAuthorized: false });
    return { conversation, job, requestId };
  }
  it('persists the reviewed mapping, routes methods in topological order, and commits on the original job', async () => {
    const f = await fixture(), before = await counts(), accepted = await submit(f);
    const planner = app.get(AgentPlannerService), spy = vi.spyOn(planner, 'plan');
    try {
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const latest = await app.get(ConsumerService).conversation(owner.userId, f.conversation.id);
      const output = latest.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      const snapshot = compositionAuthoringSnapshotSchema.parse(output.structuredPayload?.composition);
      expect(snapshot.selection).toEqual(f.selection); expect(snapshot.kind).toBe('PLANNING_REFERENCE');
      expect(snapshot).toMatchObject({ executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED', orderedMethodIds: [f.refs[1].entryId, f.refs[0].entryId] });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]?.methodRefs).toEqual([f.refs[1], f.refs[0]]);
      const context = JSON.parse(spy.mock.calls[0][2]!.contextSources!.find(row => row.label === 'reviewed_method_composition')!.content);
      expect(context).toMatchObject({ inputLinks: f.selection.graph.links, deliveries: f.selection.graph.deliveries, executionAuthorized: false });
      expect(latest.authoringJobs.find(row => row.jobId === accepted.job.jobId)?.status).toBe('SUCCEEDED');
      expect(await counts()).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it('identical retries return the same computation even after completion; changed mappings conflict', async () => {
    const f = await fixture(), accepted = await submit(f);
    await app.get(AuthoringJobsService).process(accepted.job.jobId);
    const replay = (await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: accepted.requestId, selection: f.selection }).expect(201)).body;
    expect(replay.authoringJobs.filter((row: { requestId: string }) => row.requestId === accepted.requestId)).toHaveLength(1);
    expect(replay.authoringJobs.find((row: { requestId: string }) => row.requestId === accepted.requestId).jobId).toBe(accepted.job.jobId);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: accepted.requestId, selection: { ...f.selection, graph: { ...f.selection.graph, deliveries: [{ ...f.selection.graph.deliveries[0], label: '另一成果' }] } } }).expect(409);
  });
  it('rejects another owner, injected authority, forged reviewed hashes and blocked structure before admission', async () => {
    const f = await fixture(), before = await counts();
    await request(app.getHttpServer()).post(f.endpoint).set(auth(other.token)).send({ requestId: randomUUID(), selection: f.selection }).expect(404);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: randomUUID(), selection: { ...f.selection, executionAuthorized: true } }).expect(400);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: randomUUID(), selection: { ...f.selection, basis: { ...f.selection.basis, goalBriefRef: { ...f.selection.basis.goalBriefRef, contentHash: 'a'.repeat(64) } } } }).expect(409);
    await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: randomUUID(), selection: { ...f.selection, graph: { ...f.selection.graph, links: [] } } }).expect(400);
    expect(await counts()).toEqual(before);
    const jobs = await db.select().from(authoringJobs).where(and(eq(authoringJobs.userId, owner.userId), eq(authoringJobs.conversationId, f.conversation.id)));
    expect(jobs).toHaveLength(1); // only the original ordinary input
  });
  it('withdrawn methods prevent queued computation from calling the model', async () => {
    const f = await fixture(), accepted = await submit(f);
    await app.get(SkillRepositoriesService).change(owner.userId, f.repository.id, f.repository.version, false);
    const spy = vi.spyOn(app.get(AgentPlannerService), 'plan');
    try {
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      expect(spy).not.toHaveBeenCalled();
      const current = await app.get(ConsumerService).conversation(owner.userId, f.conversation.id);
      expect(current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')?.structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['SKILL_CONTEXT_CHANGED'] });
    } finally { spy.mockRestore(); }
  });
  it('a changed source during generation discards the proposal at publication', async () => {
    const f = await fixture(), accepted = await submit(f), source = f.selection.basis.sourceMessageRefs[0];
    const planner = app.get(AgentPlannerService), original = planner.plan.bind(planner);
    const spy = vi.spyOn(planner, 'plan').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await db.update(consumerMessages).set({ content: '隔离来源已撤回' }).where(eq(consumerMessages.id, source.id));
      return result;
    });
    try {
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, f.conversation.id);
      expect(current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')?.structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['COMPOSITION_GOAL_SOURCE_UNAVAILABLE'] });
    } finally { spy.mockRestore(); }
  });
  it('reobserves resources for the current processing version and blocks an inconsistent graph', async () => {
    const f = await fixture(), accepted = await submit(f), resources = app.get(GoalResourceMatchService), original = resources.forAuthoring.bind(resources);
    const spy = vi.spyOn(resources, 'forAuthoring').mockImplementationOnce(async (...args) => ({ ...await original(...args), methods: [] }));
    const model = vi.spyOn(app.get(AgentPlannerService), 'plan');
    try {
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      expect(spy).toHaveBeenCalledWith(owner.userId, f.conversation.id, f.selection.graph.version + 1); expect(model).not.toHaveBeenCalled();
      const current = await app.get(ConsumerService).conversation(owner.userId, f.conversation.id);
      expect(current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')?.structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['COMPOSITION_RESOURCES_CHANGED'] });
    } finally { spy.mockRestore(); model.mockRestore(); }
  });
  it('checks source hashes again inside admission after the preview has completed', async () => {
    const f = await fixture(), consumer = app.get(ConsumerService), original = consumer.message.bind(consumer);
    const spy = vi.spyOn(consumer, 'message').mockImplementationOnce(async (...args) => {
      await db.update(consumerMessages).set({ content: '预览后原输入已更改' }).where(eq(consumerMessages.id, f.selection.basis.sourceMessageRefs[0].id));
      return original(...args);
    });
    try { await request(app.getHttpServer()).post(f.endpoint).set(auth(owner.token)).send({ requestId: randomUUID(), selection: f.selection }).expect(409); }
    finally { spy.mockRestore(); }
  });
  it.each(['PLAN_DRAFT', 'USER_EVENT_DRAFT', 'ACTION_PROPOSAL'] as const)('rechecks source withdrawal before original %s confirmation', async result => {
    const f = await fixture(result === 'PLAN_DRAFT' ? 'PLAN' : 'TEMPORARY'), accepted = await submit(f);
    await app.get(AuthoringJobsService).process(accepted.job.jobId);
    const current = await app.get(ConsumerService).conversation(owner.userId, f.conversation.id);
    const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
    // Isolated authority-guard fixture. The payload is not counted as a compiled or executed real proposal.
    await db.update(consumerMessages).set({ structuredPayload: { ...output.structuredPayload, result, proposal: { draftDefinition: {} }, validationErrors: [] } }).where(eq(consumerMessages.id, output.id));
    await db.update(consumerMessages).set({ content: '已撤回的原目标' }).where(eq(consumerMessages.id, f.selection.basis.sourceMessageRefs[0].id));
    const route = result === 'PLAN_DRAFT' ? 'confirm-plan' : result === 'USER_EVENT_DRAFT' ? 'confirm-user-event' : 'confirm-action';
    const before = await counts();
    const response = (await request(app.getHttpServer()).post(`/api/conversations/${current.id}/${route}`).set(auth(owner.token)).send({ version: current.version, confirmed: true, ...(result === 'PLAN_DRAFT' ? {} : { messageId: output.id }) }).expect(409)).body;
    expect(response.message).toBe('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
    expect(await counts()).toEqual(before);
  });
  const reportPlan = { title: '学习目标分析报告', prompt: '根据用户目标、已选方法及明确假设生成报告。'.repeat(10), sections: ['目标', '条件', '风险', '学习建议'], assumptions: ['学习效果待观察'], researchQuestions: [], connectionIds: [], financialModel: null };
  async function reportFixture() {
    const model = app.get(ReportModelService);
    const spies = [vi.spyOn(model, 'runMethod').mockImplementation(async (_userId, _goal, _plan, _composition, method, inputs) => ({ value: { outputs: method.manifest.name === 'ResearchMethod' ? { research: `研究产物：${inputs.goal}` } : { report: `报告产物：${inputs.research}` }, sourceIds: [] }, modelId: 'isolated' })), vi.spyOn(model, 'plan').mockResolvedValue({ value: reportPlan, modelId: 'isolated' }),
      vi.spyOn(model, 'write').mockResolvedValue({ value: { markdown: reportPlan.sections.join('\n') + '明确假设的学习分析。'.repeat(100) }, modelId: 'isolated' }),
      vi.spyOn(model, 'review').mockResolvedValue({ value: { issues: [] }, modelId: 'isolated' })];
    try { return { f: await fixture('TEMPORARY', true), model, restore: () => spies.forEach(spy => spy.mockRestore()) }; }
    catch (error) { spies.forEach(spy => spy.mockRestore()); throw error; }
  }
  it('routes reviewed report guidance through the original report worker and retains it in writing and review', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f), before = await counts();
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      let current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      expect(output.structuredPayload?.report).toMatchObject({ stage: 'QUEUED', requirementContext: { composition: { adapter: 'REPORT_METHOD_CHAIN_V1' } } });
      await app.get(ReportGenerationService).process(output.id);
      current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const report = current.messages.find(row => row.id === output.id)!.structuredPayload!.report as any;
      expect(report.stage).toBe('COMPLETED');
      expect(report.requirementContext.composition.methods.map((method: any) => method.ref.entryId)).toEqual([flow.f.refs[1].entryId, flow.f.refs[0].entryId]);
      expect(vi.mocked(flow.model.write).mock.calls.at(-1)?.[7]?.composition?.snapshot.selectionHash).toBe(report.requirementContext.composition.snapshot.selectionHash);
      expect(vi.mocked(flow.model.review).mock.calls.at(-1)?.[5]?.composition?.snapshot.selectionHash).toBe(report.requirementContext.composition.snapshot.selectionHash);
      expect(await counts()).toEqual(before);
    } finally { flow.restore(); }
  });
  it('stops a queued report before any model work if its reviewed source has been withdrawn', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      const calls = vi.mocked(flow.model.plan).mock.calls.length;
      await db.update(consumerMessages).set({ content: '撤回原目标' }).where(eq(consumerMessages.id, flow.f.selection.basis.sourceMessageRefs[0].id));
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(final.messages.find(row => row.id === output.id)!.structuredPayload!.report).toMatchObject({ stage: 'FAILED', errorCode: 'COMPOSITION_GOAL_SOURCE_UNAVAILABLE' });
      expect(vi.mocked(flow.model.plan).mock.calls.length).toBe(calls);
    } finally { flow.restore(); }
  });
  it('refuses publication if a method is disabled during writing', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      vi.mocked(flow.model.write).mockImplementationOnce(async () => {
        await app.get(SkillRepositoriesService).change(owner.userId, flow.f.repository.id, flow.f.repository.version, false);
        return { value: { markdown: reportPlan.sections.join('\n') + '明确假设。'.repeat(200) }, modelId: 'isolated' };
      });
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(final.messages.find(row => row.id === output.id)!.structuredPayload!.report).toMatchObject({ stage: 'FAILED', errorCode: 'SKILL_CONTEXT_CHANGED' });
    } finally { flow.restore(); }
  });

  it.each(['deadline', 'calls'] as const)('keeps the persisted %s budget across recovery and stops without another provider call', async kind => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      const report = output.structuredPayload!.report as any;
      report.budget = { ...report.budget, ...(kind === 'deadline' ? { deadlineAt: new Date(Date.now() - 1000).toISOString() } : { modelCalls: 16, reservedOutputTokens: 131072 }) };
      await db.update(consumerMessages).set({ structuredPayload: { ...output.structuredPayload, report } }).where(eq(consumerMessages.id, output.id));
      const calls = vi.mocked(flow.model.plan).mock.calls.length;
      vi.mocked(flow.model.plan).mockImplementationOnce(async (...args) => { await args[4]!.reserve(); throw new Error('PROVIDER_MUST_NOT_BE_CALLED'); });
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const stopped = final.messages.find(row => row.id === output.id)!.structuredPayload!.report as any;
      expect(stopped).toMatchObject({ stage: 'FAILED', errorCode: kind === 'deadline' ? 'REPORT_BUDGET_DEADLINE' : 'REPORT_BUDGET_MODEL_LIMIT' });
      expect(stopped.budget.modelCalls).toBe(report.budget.modelCalls);
      if (kind === 'deadline') expect(vi.mocked(flow.model.plan).mock.calls.length).toBe(calls);
      await app.get(ReportGenerationService).process(output.id);
      const replay = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(replay.messages.find(row => row.id === output.id)!.structuredPayload!.report).toEqual(stopped);
    } finally { flow.restore(); }
  });

  it('refuses a report outline that drops a reviewed deliverable', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      vi.mocked(flow.model.plan).mockResolvedValueOnce({ value: { ...reportPlan, sections: ['目标', '条件', '风险', '其它建议'] }, modelId: 'isolated' });
      const calls = vi.mocked(flow.model.write).mock.calls.length;
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(final.messages.find(row => row.id === output.id)!.structuredPayload!.report).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_COMPOSITION_DELIVERY_REQUIRED' });
      expect(vi.mocked(flow.model.write).mock.calls.length).toBe(calls);
    } finally { flow.restore(); }
  });

  it.each([false, true])('persists actual method data through final writing and review, correction=%s', async correction => {
    const flow = await reportFixture();
    try {
      // The fixture also generates the original source report; count only this new composition.
      vi.mocked(flow.model.write).mockClear();
      vi.mocked(flow.model.review).mockClear();
      if (correction) vi.mocked(flow.model.review).mockResolvedValueOnce({ value: { issues: ['isolated correction required'] }, modelId: 'isolated' });
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const report = final.messages.find(row => row.id === output.id)!.structuredPayload!.report as any;
      expect(report.stage).toBe('COMPLETED');
      expect(report.methodRuns.map((run: any) => run.methodRef.entryId)).toEqual([flow.f.refs[1].entryId, flow.f.refs[0].entryId]);
      expect(vi.mocked(flow.model.runMethod).mock.calls[1][5]).toEqual({ research: report.methodRuns[0].outputs.research });
      expect(report.methodRuns[1].inputs).toEqual({ research: report.methodRuns[0].outputs.research });
      expect(vi.mocked(flow.model.write).mock.calls.at(-1)?.[8]).toEqual(report.methodRuns);
      expect(vi.mocked(flow.model.review).mock.calls.at(-1)?.[6]).toEqual(report.methodRuns);
      expect(vi.mocked(flow.model.review).mock.calls).toHaveLength(correction ? 2 : 1);
      expect(vi.mocked(flow.model.write).mock.calls).toHaveLength(correction ? 2 : 1);
      expect(report.methodRuns.every((run: any) => run.semanticVerified === false && run.verification === 'CONTRACT_CHECKED_ONLY')).toBe(true);
    } finally { flow.restore(); }
  });
  it.each(['resume', 'tamper'] as const)('preserves the first node across an interrupted second node: %s', async mode => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f);
      await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      vi.mocked(flow.model.runMethod).mockResolvedValueOnce({ value: { outputs: { research: '第一步真实保存的隔离研究' }, sourceIds: [] }, modelId: 'isolated' })
        .mockRejectedValueOnce(new Error('REPORT_STATE_CHANGED'));
      await app.get(ReportGenerationService).process(output.id);
      const paused = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const saved = paused.messages.find(row => row.id === output.id)!;
      const report = saved.structuredPayload!.report as any;
      expect(report.stage).toBe('COMPOSING'); expect(report.methodRuns).toHaveLength(1);
      const calls = vi.mocked(flow.model.runMethod).mock.calls.length;
      if (mode === 'tamper') {
        report.methodRuns[0].outputs.research = '篡改后的输出';
        await db.update(consumerMessages).set({ structuredPayload: { ...saved.structuredPayload, report } }).where(eq(consumerMessages.id, output.id));
      }
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const result = final.messages.find(row => row.id === output.id)!.structuredPayload!.report as any;
      if (mode === 'resume') {
        expect(result.stage).toBe('COMPLETED'); expect(result.methodRuns).toHaveLength(2);
        expect(result.methodRuns[0]).toEqual(report.methodRuns[0]);
        expect(vi.mocked(flow.model.runMethod).mock.calls.length).toBe(calls + 1);
      } else {
        expect(result).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_METHOD_STATE_INVALID' });
        expect(vi.mocked(flow.model.runMethod).mock.calls.length).toBe(calls);
      }
    } finally { flow.restore(); }
  });
  it('does not invoke downstream methods or writing after an invalid first output', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f); await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      const writes = vi.mocked(flow.model.write).mock.calls.length;
      vi.mocked(flow.model.runMethod).mockResolvedValueOnce({ value: { outputs: { research: 12 }, sourceIds: [] }, modelId: 'isolated' });
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(final.messages.find(row => row.id === output.id)!.structuredPayload!.report).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_METHOD_OUTPUT_INVALID', methodRuns: [] });
      expect(vi.mocked(flow.model.runMethod).mock.calls).toHaveLength(1);
      expect(vi.mocked(flow.model.write).mock.calls.length).toBe(writes);
    } finally { flow.restore(); }
  });
  it('fences repository withdrawal between method computation and persisting its result', async () => {
    const flow = await reportFixture();
    try {
      const accepted = await submit(flow.f); await app.get(AuthoringJobsService).process(accepted.job.jobId);
      const current = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      const output = current.messages.find(row => row.requestId === accepted.requestId && row.role === 'assistant')!;
      vi.mocked(flow.model.runMethod).mockImplementationOnce(async () => {
        await app.get(SkillRepositoriesService).change(owner.userId, flow.f.repository.id, flow.f.repository.version, false);
        return { value: { outputs: { research: '旧方法产生但未接受的结果' }, sourceIds: [] }, modelId: 'isolated' };
      });
      await app.get(ReportGenerationService).process(output.id);
      const final = await app.get(ConsumerService).conversation(owner.userId, flow.f.conversation.id);
      expect(final.messages.find(row => row.id === output.id)!.structuredPayload!.report).toMatchObject({ stage: 'FAILED', errorCode: 'SKILL_CONTEXT_CHANGED', methodRuns: [] });
    } finally { flow.restore(); }
  });

});
