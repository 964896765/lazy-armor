import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { agentReportSchema } from '@lazy-armor/plan-schema';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FakeAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

interface Event { event: string; pid: number; observedAt: string; intentHash?: string; code?: string }
interface Worker { child: ChildProcess; events: Event[]; exited: Promise<void>; closed: boolean }
interface Conversation {
  id: string; version: number; status: string; planId: string | null;
  messages: Array<{ id: string; role: string; content: string; structuredPayload: Record<string, unknown> }>;
  authoringJobs: Array<{ jobId: string; status: string; attemptCount: number }>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 250));

describe.sequential('V91 independent-process hard interruption and recovery; fixture model, real SQL/Redis', { timeout: 180_000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, jobs: AuthoringJobsService;
  let redis: IORedis, queue: Queue<{ jobId: string }>;
  let reportQueue: Queue<{ messageId: string }>;
  let previousPrefix: string | undefined, previousTestPrefix: string | undefined;
  let previousDatabaseName: string | undefined, previousRedis: string | undefined;
  let completed = 0;
  const workers: Worker[] = [], records: Record<string, unknown>[] = [];
  const evidence = process.env.V91_PROCESS_EVIDENCE;
  const saveEvidence = () => { if (evidence) writeFileSync(evidence, JSON.stringify({ schemaVersion: 'v91-process-recovery.v1',
    updatedAt: new Date().toISOString(), scope: 'FIXTURE_MODEL_REAL_CHILD_PROCESSES_SQL_REDIS', completed,
    databaseName: process.env.TEST_DATABASE_NAME, artificialClockOrLeaseEdits: false, records,
    children: workers.map(worker => ({ pid: worker.child.pid, exited: worker.closed, events: worker.events })),
    mobileAcceptance: 'PENDING', realModelAcceptance: 'SEPARATE_EVIDENCE' }, null, 2)); };
  async function until(check: () => Promise<boolean> | boolean, timeout = 90_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await pause(); }
    throw new Error('V91_PROCESS_WAIT_TIMEOUT');
  }
  async function stop(worker: Worker) {
    if (worker.closed) return;
    worker.child.kill('SIGKILL');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([worker.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CHILD_DID_NOT_EXIT')), 10_000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function start(mode: 'BLOCK' | 'FINISH', includeReports = false) {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', APP_ROLE: 'api', V91_CHILD_MODE: mode, V91_CHILD_REPORTS: includeReports ? '1' : '0' };
    delete env.AGENT_MODEL_API_KEY;
    const child = spawn(process.execPath, [path.join(process.cwd(), 'test/fixtures/v91-authoring-worker.cjs')],
      { cwd: process.cwd(), windowsHide: true, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const worker: Worker = { child, events: [], closed: false, exited: Promise.resolve() };
    worker.exited = new Promise<void>(resolve => { child.once('close', () => { worker.closed = true; resolve(); }); });
    child.on('error', () => { worker.events.push({ event: 'SPAWN_FAILED', pid: child.pid ?? 0, observedAt: new Date().toISOString() }); });
    child.on('message', event => { worker.events.push(event as Event); saveEvidence(); });
    workers.push(worker);
    await until(() => {
      if (worker.closed || worker.events.some(event => ['CHILD_FAILED', 'SPAWN_FAILED'].includes(event.event))) throw new Error('V91_CHILD_START_FAILED');
      return worker.events.some(event => event.event === 'WORKER_READY');
    }, 25_000);
    return worker;
  }
  const get = async (id: string) => (await request(app.getHttpServer()).get(`/api/conversations/${id}`).set(auth(owner.token)).expect(200)).body as Conversation;
  async function submit(conversationId: string, content: string, version: number) {
    const input = { content, version, requestId: randomUUID(), authoringMode: 'DURABLE' };
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${conversationId}/messages`).set(auth(owner.token)).send(input).expect(201)).body as Conversation;
    return { input, result, jobId: result.authoringJobs.at(-1)!.jobId, messageId: result.messages.at(-1)!.id };
  }
  async function create() {
    return (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token))
      .send({ mode: 'TEMPORARY', title: 'V91进程恢复隔离验收' }).expect(201)).body as Conversation;
  }
  async function lease(jobId: string) {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT status,attempt_count attemptCount,lease_expires_at expiresAt,deadline_at deadlineAt FROM authoring_jobs WHERE id=UUID_TO_BIN(?)', [jobId]);
    return rows[0]!;
  }
  async function noExecution() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans, '
      + '(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions, (SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations, '
      + '(SELECT COUNT(*) FROM device_tasks WHERE user_id=UUID_TO_BIN(?)) deviceTasks, (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', Array(5).fill(owner.userId));
    expect(rows[0]).toMatchObject({ plans: 0, executions: 0, invocations: 0, deviceTasks: 0, truths: 0 });
    return rows[0];
  }
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
    const redisTarget = new URL(process.env.REDIS_URL ?? 'redis://invalid');
    const local = database.port === '3311' && redisTarget.port === '6391';
    const ci = process.env.CI === 'true' && database.pathname === '/lazy_armor_ci_test' && redisTarget.port === '6379';
    if (database.hostname !== '127.0.0.1' || redisTarget.hostname !== '127.0.0.1' || (!local && !ci)
        || !/^\/lazy_armor_[a-z0-9_]+_test$/.test(database.pathname)) throw new Error('Isolated V91 process target required');
    if (evidence && existsSync(evidence)) throw new Error('Fresh process evidence required');
    if (process.env.V91_PROCESS_REPORTS === '1' && !/^\/lazy_armor_v91_process_\d{8}_[a-f0-9]{8}_test$/.test(database.pathname))
      throw new Error('Report crash acceptance requires the script-created fresh database');
    if (!existsSync(path.join(process.cwd(), 'dist/orchestrator/authoring-jobs.service.js'))) throw new Error('API build required before process acceptance');
    previousPrefix = process.env.REDIS_KEY_PREFIX; previousTestPrefix = process.env.TEST_REDIS_KEY_PREFIX;
    previousDatabaseName = process.env.TEST_DATABASE_NAME; previousRedis = process.env.REDIS_URL;
    process.env.REDIS_KEY_PREFIX = process.env.TEST_REDIS_KEY_PREFIX = 'v91-process:' + randomUUID();
    process.env.TEST_DATABASE_NAME = database.pathname.slice(1);
    redisTarget.pathname = '/15'; process.env.REDIS_URL = redisTarget.href;
    ({ app, pool } = await bootP2App('v91-process-' + randomUUID(), [{ token: AGENT_MODEL, value: new FakeAgentModel() }]));
    owner = await register(app, randomUUID() + '@example.test', 'V91进程隔离用户');
    other = await register(app, randomUUID() + '@example.test', 'V91另一进程隔离用户');
    jobs = app.get(AuthoringJobsService);
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue('lazy-armor-authoring', { connection: redis, prefix: process.env.REDIS_KEY_PREFIX });
    reportQueue = new Queue('lazy-armor-reports', { connection: redis, prefix: process.env.REDIS_KEY_PREFIX });
  });
  afterEach(async () => { for (const worker of workers) await stop(worker); saveEvidence(); });
  afterAll(async () => {
    try { for (const worker of workers) await stop(worker); await reportQueue?.close(); await queue?.close(); if (redis && redis.status !== 'end') await redis.quit(); await app?.close(); await pool?.end(); saveEvidence(); }
    finally {
      for (const [key, value] of Object.entries({ REDIS_KEY_PREFIX: previousPrefix, TEST_REDIS_KEY_PREFIX: previousTestPrefix,
        TEST_DATABASE_NAME: previousDatabaseName, REDIS_URL: previousRedis })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  it('recovers the same saved request after a real worker is killed, without changing time or its persisted lease', async () => {
    const conversation = await create();
    const flow = await submit(conversation.id, '请整理本周学习目标，进程恢复验收数据', 0);
    const first = await start('BLOCK');
    await until(() => first.events.some(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(flow.input.content)), 25_000);
    const before = await lease(flow.jobId);
    expect(before.status).toBe('RUNNING'); expect(before.attemptCount).toBe(1);
    expect(before.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await stop(first);
    expect((await get(conversation.id)).messages.at(-1)!.structuredPayload.result).toBe('AUTHORING_PENDING');
    expect(await jobs.claim(flow.jobId)).toBeNull();
    const second = await start('FINISH');
    await until(async () => (await jobs.get(owner.userId, flow.jobId)).status === 'SUCCEEDED');
    const final = await get(conversation.id), job = await jobs.get(owner.userId, flow.jobId);
    expect(job.attemptCount).toBe(2); expect(final.status).toBe('ACTIVE'); expect(final.messages).toHaveLength(2);
    expect(final.messages.at(-1)!).toMatchObject({ id: flow.messageId, content: '这是固定回答。', structuredPayload: { result: 'ANSWER' } });
    expect(second.events.filter(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(flow.input.content))).toHaveLength(1);
    await request(app.getHttpServer()).get(`/api/authoring-jobs/${flow.jobId}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send(flow.input).expect(201);
    await jobs.enqueue(flow.jobId);
    await until(async () => !await queue.getJob(flow.jobId));
    expect((await get(conversation.id)).messages).toHaveLength(2);
    expect((await jobs.get(owner.userId, flow.jobId)).attemptCount).toBe(2);
    expect(second.events.filter(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(flow.input.content))).toHaveLength(1);
    records.push({ case: 'KILL_RESTART_RECOVER', jobId: flow.jobId, firstPid: first.child.pid, secondPid: second.child.pid,
      interruptedLeaseExpiresAt: before.expiresAt.toISOString(), finalAttemptCount: job.attemptCount, finalMessageId: flow.messageId,
      redeliveryModelCalls: 0, counts: await noExecution() });
    expect(workers.flatMap(worker => worker.events).some(event => event.event === 'NETWORK_ATTEMPT')).toBe(false);
    completed++; saveEvidence(); console.log(JSON.stringify({ processCase: 'KILL_RESTART_RECOVER', passed: true }));
  });
  it('keeps a killed calculation cancelled after restart and lets a new request finish in the same conversation', async () => {
    const conversation = await create();
    const flow = await submit(conversation.id, '整理英语学习条件，取消恢复验收数据', 0);
    const first = await start('BLOCK');
    await until(() => first.events.some(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(flow.input.content)), 25_000);
    await stop(first);
    await request(app.getHttpServer()).post(`/api/authoring-jobs/${flow.jobId}/cancel`).set(auth(owner.token)).send({}).expect(201);
    const cancelled = await get(conversation.id);
    expect(cancelled.status).toBe('ACTIVE'); expect(cancelled.authoringJobs.at(-1)!.status).toBe('CANCELLED');
    const second = await start('FINISH');
    await jobs.enqueue(flow.jobId);
    const next = await submit(conversation.id, '改为整理下周阅读目标，新的进程验收需求', cancelled.version);
    await until(async () => (await jobs.get(owner.userId, next.jobId)).status === 'SUCCEEDED');
    await until(async () => !await queue.getJob(flow.jobId));
    const final = await get(conversation.id);
    expect(final.messages).toHaveLength(4); expect(final.messages.find(message => message.id === flow.messageId)!.structuredPayload.result).toBe('AUTHORING_STOPPED');
    expect(final.messages.at(-1)!.structuredPayload.result).toBe('ANSWER');
    expect((await jobs.get(owner.userId, flow.jobId)).status).toBe('CANCELLED');
    expect(second.events.filter(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(flow.input.content))).toHaveLength(0);
    expect(second.events.filter(event => event.event === 'MODEL_ENTERED' && event.intentHash === digest(next.input.content))).toHaveLength(1);
    records.push({ case: 'KILL_CANCEL_RESTART_NEW_REQUEST', cancelledJobId: flow.jobId, nextJobId: next.jobId,
      firstPid: first.child.pid, secondPid: second.child.pid, cancelledRequestModelCallsAfterRestart: 0, counts: await noExecution() });
    expect(workers.flatMap(worker => worker.events).some(event => event.event === 'NETWORK_ATTEMPT')).toBe(false);
    completed++; saveEvidence(); console.log(JSON.stringify({ processCase: 'KILL_CANCEL_RESTART_NEW_REQUEST', passed: true }));
  });
  it.skipIf(process.env.V91_PROCESS_REPORTS !== '1')('continues an interrupted report from the saved prompt and M1 without creating another report', async () => {
    const conversation = await create();
    const flow = await submit(conversation.id, '湖北荆门租赁2工位人工洗车加基础美容，预算15万元，生成商业评估报告；参数为进程恢复验收假设。', 0);
    await jobs.process(flow.jobId);
    const first = await start('BLOCK', true);
    await until(() => first.events.some(event => event.event === 'REPORT_WRITE_ENTERED' && event.intentHash === digest(flow.input.content)), 25_000);
    const interruptedConversation = await get(conversation.id);
    const interrupted = agentReportSchema.parse(interruptedConversation.messages.find(message => message.id === flow.messageId)!.structuredPayload.report);
    expect(interrupted.stage).toBe('WRITING'); expect(interrupted.plan).toBeTruthy(); expect(interrupted.markdown).toBeUndefined();
    expect((await jobs.get(owner.userId, flow.jobId)).status).toBe('SUCCEEDED');
    const originalM1 = interrupted.sources.find(source => source.id === 'M1')!;
    expect(originalM1.sha256).toBe(digest(originalM1.content));
    await stop(first);
    const second = await start('FINISH', true);
    await until(async () => {
      const current = await get(conversation.id);
      return agentReportSchema.parse(current.messages.find(message => message.id === flow.messageId)!.structuredPayload.report).stage === 'COMPLETED';
    });
    await until(async () => !await reportQueue.getJob(flow.messageId));
    const final = await get(conversation.id), report = agentReportSchema.parse(final.messages.find(message => message.id === flow.messageId)!.structuredPayload.report);
    expect(final.messages).toHaveLength(2); expect(final.planId).toBeNull();
    expect(report.plan).toEqual(interrupted.plan); expect(report.requirementContext).toEqual(interrupted.requirementContext);
    expect(report.sources.find(source => source.id === 'M1')).toEqual(originalM1);
    expect(report.markdown).toContain('收入敏感性（程序计算，模型假设）'); expect(report.review?.issues).toEqual([]);
    expect(second.events.some(event => event.event === 'REPORT_PLAN' && event.intentHash === digest(flow.input.content))).toBe(false);
    expect(second.events.filter(event => event.event === 'REPORT_WRITE_ENTERED' && event.intentHash === digest(flow.input.content))).toHaveLength(1);
    const projection = (await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(projection.statusGroup).toBe('COMPLETED'); expect(projection.report).toMatchObject({ messageId: flow.messageId, marketFactsVerified: false });
    await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send(flow.input).expect(201);
    await reportQueue.add('generate-report', { messageId: flow.messageId }, { jobId: flow.messageId, removeOnComplete: true, removeOnFail: true });
    await until(async () => !await reportQueue.getJob(flow.messageId));
    expect(second.events.filter(event => event.event === 'REPORT_WRITE_ENTERED' && event.intentHash === digest(flow.input.content))).toHaveLength(1);
    expect((await get(conversation.id)).messages).toHaveLength(2);
    records.push({ case: 'REPORT_KILL_RESTART_SAVED_PLAN_M1', messageId: flow.messageId, jobId: flow.jobId,
      firstPid: first.child.pid, secondPid: second.child.pid, savedPlanUnchanged: true, m1Sha256: originalM1.sha256,
      reportPlanCallsAfterRestart: 0, reportWriteCallsAfterRestart: 1, terminalRedeliveryModelCalls: 0, counts: await noExecution() });
    expect(workers.flatMap(worker => worker.events).some(event => event.event === 'NETWORK_ATTEMPT')).toBe(false);
    completed++; saveEvidence(); console.log(JSON.stringify({ processCase: 'REPORT_KILL_RESTART_SAVED_PLAN_M1', passed: true }));
  });
});
