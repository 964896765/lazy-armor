import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AGENT_MODEL, AgentPlannerService, type PlannerResult } from '../src/ai-adapter/agent-planner.service';
import { FixtureAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { ConsumerService } from '../src/consumer/consumer.service';

describe.sequential('V91 goal authoring through the original public lifecycle', { timeout: 90_000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, jobs: AuthoringJobsService;
  const answer: PlannerResult = { proposalId: '01900000-0000-7000-8000-000000000001', result: 'ANSWER',
    answer: { explanation: '这是隔离自动化答复，并非本人或真实模型验收。' }, validationErrors: [], warnings: [] };
  let previousRedisPrefix: string | undefined;
  beforeAll(async () => {
    const unique = `v91-goal-${Date.now()}`;
    const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
    const redis = new URL(process.env.REDIS_URL ?? 'redis://invalid');
    const ciTarget = process.env.CI === 'true' && database.pathname === '/lazy_armor_ci_test' && redis.hostname === '127.0.0.1';
    if (!database.pathname.endsWith('_test') || (redis.port !== '6391' && !ciTarget)) throw new Error('Isolated V91 database and Redis required');
    previousRedisPrefix = process.env.REDIS_KEY_PREFIX;
    process.env.REDIS_KEY_PREFIX = `v91:${unique}`;
    ({ app, pool } = await bootP2App(unique, [{ token: AGENT_MODEL, value: new FixtureAgentModel() }]));
    owner = await register(app, `${unique}@example.com`, 'V91隔离用户');
    other = await register(app, `${unique}-other@example.com`, '另一隔离用户');
    jobs = app.get(AuthoringJobsService);
  });
  afterAll(async () => {
    vi.restoreAllMocks(); await app?.close(); await pool?.end();
    if (previousRedisPrefix === undefined) delete process.env.REDIS_KEY_PREFIX;
    else process.env.REDIS_KEY_PREFIX = previousRedisPrefix;
  });
  const get = (id: string) => request(app.getHttpServer()).get(`/api/conversations/${id}`).set(auth(owner.token)).expect(200);
  async function create(mode: 'TEMPORARY' | 'PLAN' = 'TEMPORARY') {
    return (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode, title: 'V91目标' }).expect(201)).body;
  }
  async function submit(id: string, content: string, version = 0, requestId = `v91-${Date.now()}-${Math.random()}`) {
    const input = { content, requestId, version, authoringMode: 'DURABLE' };
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(owner.token)).send(input).expect(201)).body;
    return { result, input, job: result.authoringJobs.at(-1), message: result.messages.at(-1) };
  }
  it('persists input and job, returns before the model, and scopes progress to its owner', async () => {
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan').mockResolvedValue(answer);
    const conversation = await create();
    const flow = await submit(conversation.id, '请帮我整理本周学习目标，预算500元');
    expect(flow.job.status).toBe('QUEUED'); expect(flow.message.structuredPayload.result).toBe('AUTHORING_PENDING');
    expect(flow.message.structuredPayload.goalBrief.fields.find((field: { key: string }) => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '预算500元' });
    expect(planner).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`/api/authoring-jobs/${flow.job.jobId}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(other.token)).expect(404);
    await jobs.process(flow.job.jobId);
    const completed = (await get(conversation.id)).body;
    expect(completed.messages).toHaveLength(2); expect(completed.authoringJobs.at(-1).status).toBe('SUCCEEDED');
    expect(completed.messages.at(-1).structuredPayload.result).toBe('ANSWER');
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send(flow.input).expect(201);
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send({ ...flow.input, content: '另一个需求' }).expect(409);
    expect(planner).toHaveBeenCalledTimes(1); planner.mockRestore();
  });
  it('asks for the missing entrepreneurial scope without a model call, Plan or Execution', async () => {
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan');
    const conversation = await create(); const flow = await submit(conversation.id, '我想创业');
    await jobs.process(flow.job.jobId);
    const result = (await get(conversation.id)).body;
    expect(result.messages.at(-1).structuredPayload.result).toBe('CLARIFICATION_REQUIRED');
    expect(result.messages.at(-1).structuredPayload.goalBrief.readiness.questions).toHaveLength(1);
    expect(result.planId).toBeNull(); expect(planner).not.toHaveBeenCalled(); planner.mockRestore();
  });
  it('a follow-up receives the previous declared budget as data through the original planner', async () => {
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan').mockResolvedValue(answer);
    const conversation = await create(); const first = await submit(conversation.id, '规划我的学习目标，预算500元');
    await jobs.process(first.job.jobId); const previous = (await get(conversation.id)).body;
    const next = await submit(conversation.id, '把时间安排细化到每周', previous.version);
    await jobs.process(next.job.jobId);
    const sources = planner.mock.calls.at(-1)?.[2]?.contextSources ?? [];
    const summary = JSON.parse(sources.find(source => source.label === 'goal_requirements')!.content);
    expect(summary.fields.find((field: { key: string }) => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '预算500元', sourceRefs: [{ kind: 'USER_MESSAGE', id: first.result.messages.find((message: { role: string }) => message.role === 'user').id }] });
    expect(summary.executionAuthorized).toBe(false); expect(summary).not.toHaveProperty('truths');
    planner.mockRestore();
  });
  it('a queued report is available from the goal surface but is never marked completed', async () => {
    const conversation = await create(); const flow = await submit(conversation.id, '在湖北荆门开洗车店的商业评估报告，按两工位租赁店测算');
    await jobs.process(flow.job.jobId);
    const result = (await get(conversation.id)).body;
    const report = result.messages.at(-1).structuredPayload;
    expect(report.report.stage).toBe('QUEUED'); expect(report.deliverySpec.kind).toBe('REPORT');
    const projection = (await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(projection.statusGroup).toBe('INCOMPLETE'); expect(projection.report.marketFactsVerified).toBe(false);
    expect(projection.primaryAction.path).toContain('/report?');
    const timeline = (await request(app.getHttpServer()).get('/api/timeline?date=all&timezone=Asia/Shanghai').set(auth(owner.token)).expect(200)).body;
    expect(timeline.find((item: { primaryAction: { path: string } }) => item.primaryAction.path === `/chat?conversationId=${conversation.id}`)?.statusGroup).toBe('INCOMPLETE');
  });
  it('cancellation fences an in-flight model response and releases the same conversation', async () => {
    let resolve!: (value: PlannerResult) => void;
    let entered!: () => void;
    const started = new Promise<void>(ready => { entered = ready; });
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan').mockImplementationOnce(async () => {
      entered(); return new Promise<PlannerResult>(ready => { resolve = ready; });
    });
    const conversation = await create(); const flow = await submit(conversation.id, '请整理我的学习需求');
    const running = jobs.process(flow.job.jobId); await started;
    await request(app.getHttpServer()).post(`/api/authoring-jobs/${flow.job.jobId}/cancel`).set(auth(owner.token)).send({}).expect(201);
    resolve(answer); await running;
    const result = (await get(conversation.id)).body;
    expect(result.status).toBe('ACTIVE'); expect(result.authoringJobs.at(-1).status).toBe('CANCELLED');
    expect(result.messages).toHaveLength(2); expect(result.messages.at(-1).structuredPayload.result).toBe('AUTHORING_STOPPED');
    expect(result.messages.at(-1).content).not.toBe(answer.answer!.explanation);
    expect(result.messages.at(-1).structuredPayload.goalBrief).toBeDefined(); planner.mockRestore();
  });
  it('the legacy waiting response remains compatible while the job persists', async () => {
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan').mockResolvedValue(answer);
    const conversation = await create();
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
      .send({ content: '帮我整理一次学习需求', requestId: 'v91-legacy', version: 0 }).expect(201)).body;
    expect(result.messages.at(-1).structuredPayload.result).toBe('ANSWER'); expect(result.authoringJobs.at(-1).status).toBe('SUCCEEDED');
    planner.mockRestore();
  });
  it('a legacy replay waits for the worker holding the lease without starting a second model call', async () => {
    let resolve!: (value: PlannerResult) => void;
    let entered!: () => void;
    const started = new Promise<void>(ready => { entered = ready; });
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan').mockImplementationOnce(async () => {
      entered(); return new Promise<PlannerResult>(ready => { resolve = ready; });
    });
    const conversation = await create(); const flow = await submit(conversation.id, '整理本月的学习目标');
    const running = jobs.process(flow.job.jobId); await started;
    let returned = false;
    const replay = request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
      .send({ ...flow.input, authoringMode: 'LEGACY_WAIT' }).expect(201).then(response => { returned = true; return response.body; });
    await new Promise<void>(ready => setTimeout(ready, 350));
    try { expect(returned).toBe(false); expect(planner).toHaveBeenCalledTimes(1); }
    finally { resolve(answer); }
    await running; const result = await replay;
    expect(result.messages.at(-1).structuredPayload.result).toBe('ANSWER');
    expect(result.authoringJobs.at(-1).status).toBe('SUCCEEDED'); expect(result.messages).toHaveLength(2);
    planner.mockRestore();
  });
  it('a new report inherits the declared project and latest budget without treating either as Truth', async () => {
    const conversation = await create();
    const first = await submit(conversation.id, '在湖北荆门开洗车店的商业评估报告，预算10万元，按两工位租赁店测算');
    await jobs.process(first.job.jobId); const prior = (await get(conversation.id)).body;
    const next = await submit(conversation.id, '预算改为15万元，重新生成报告', prior.version);
    await jobs.process(next.job.jobId); const result = (await get(conversation.id)).body;
    const report = result.messages.at(-1).structuredPayload.report;
    expect(report.goal).toBe('预算改为15万元，重新生成报告');
    expect(report.requirementContext.goalBrief.fields.find((field: { key: string }) => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '预算改为15万元' });
    expect(report.requirementContext.userMessages.map((message: { quote: string }) => message.quote)).toEqual([first.input.content, next.input.content]);
    const projection = (await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(projection.report.marketFactsVerified).toBe(false);
    const [truths] = await pool.query('SELECT COUNT(*) count FROM truth_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect((truths as Array<{ count: number }>)[0]!.count).toBe(0);
  });
  it('plan confirmation freezes the exact GoalBrief separately from the legacy creation hash', async () => {
    const conversation = await create('PLAN'); const flow = await submit(conversation.id, '每天帮我总结重要事项');
    await jobs.process(flow.job.jobId);
    const proposed = (await get(conversation.id)).body;
    expect(proposed.messages.at(-1).structuredPayload.result).toBe('PLAN_DRAFT');
    const brief = proposed.messages.at(-1).structuredPayload.goalBrief;
    const confirmed = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: proposed.version, confirmed: true }).expect(201)).body;
    const [rows] = await pool.query('SELECT JSON_EXTRACT(goal_brief_json, \'$.version\') version, LOWER(BIN_TO_UUID(user_id)) owner FROM plan_goal_briefs WHERE plan_id=UUID_TO_BIN(?)', [confirmed.planId]);
    expect((rows as Array<{ version: string; owner: string }>)).toHaveLength(1);
    expect(Number((rows as Array<{ version: string }>)[0]!.version)).toBe(brief.version);
    expect((rows as Array<{ owner: string }>)[0]!.owner).toBe(owner.userId);
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: proposed.version, confirmed: true }).expect(201);
    const [executions] = await pool.query('SELECT COUNT(*) count FROM executions WHERE plan_id=UUID_TO_BIN(?)', [confirmed.planId]);
    expect((executions as Array<{ count: number }>)[0]!.count).toBe(0);
    expect(app.get(ConsumerService)).toBeDefined();
  });
  it('the Redis worker consumes durable input and publishes clarification without inline processing', async () => {
    if (!process.env.REDIS_KEY_PREFIX?.startsWith('v91:')) throw new Error('Explicit isolated authoring prefix required');
    const planner = vi.spyOn(app.get(AgentPlannerService), 'plan');
    const previousEnv = { NODE_ENV: process.env.NODE_ENV, APP_ROLE: process.env.APP_ROLE };
    try {
      process.env.NODE_ENV = 'development'; process.env.APP_ROLE = 'execution-worker';
      jobs.onModuleInit();
    } finally { process.env.NODE_ENV = previousEnv.NODE_ENV; process.env.APP_ROLE = previousEnv.APP_ROLE; }
    const conversation = await create(); const flow = await submit(conversation.id, '我想创业');
    const deadline = Date.now() + 15_000;
    let job = await jobs.get(owner.userId, flow.job.jobId);
    while (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(job.status) && Date.now() < deadline) {
      await new Promise<void>(ready => setTimeout(ready, 100));
      job = await jobs.get(owner.userId, flow.job.jobId);
    }
    expect(job.status).toBe('SUCCEEDED'); expect(job.attemptCount).toBe(1);
    const result = (await get(conversation.id)).body;
    expect(result.messages.at(-1).structuredPayload.result).toBe('CLARIFICATION_REQUIRED');
    expect(planner).not.toHaveBeenCalled(); planner.mockRestore();
  });
});
