import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { agentReportSchema, type AgentReport } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';

interface ChildEvent { event: string; pid: number; name?: string; savedMethods?: number }
interface Child { process: ChildProcess; events: ChildEvent[]; exited: Promise<void>; closed: boolean }
describe.skipIf(process.env.V93_METHOD_PROCESS_ACCEPTANCE !== '1').sequential('report methods survive real process termination in an isolated database', { timeout: 180000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, redis: IORedis, queue: Queue;
  const children: Child[] = [], records: unknown[] = [];
  const evidence = process.env.V93_METHOD_PROCESS_EVIDENCE;
  const persist = () => { if (evidence) writeFileSync(evidence, JSON.stringify({ schemaVersion: 'v93-method-process.v1',
    scope: 'FIXTURE_MODEL_REAL_CHILD_PROCESSES_SQL_REDIS', records, databaseName: process.env.TEST_DATABASE_NAME,
    artificialClockOrLeaseEdits: false, children: children.map(child => ({ pid: child.process.pid, exited: child.closed, events: child.events })),
    realModelAcceptance: 'SEPARATE_EVIDENCE', mobileAcceptance: 'PENDING', at: new Date().toISOString() }, null, 2)); };
  async function until(check: () => Promise<boolean> | boolean, timeout = 120000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 250)); }
    throw new Error('METHOD_PROCESS_TIMEOUT');
  }
  async function stop(child: Child) {
    if (child.closed) return;
    child.process.kill('SIGKILL');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([child.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CHILD_DID_NOT_EXIT')), 10000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function start(mode: 'BLOCK_SECOND' | 'BLOCK_WRITE' | 'FINISH') {
    const env: NodeJS.ProcessEnv = { ...process.env, V93_METHOD_CHILD_MODE: mode };
    delete env.AGENT_MODEL_API_KEY;
    const processChild = spawn(process.execPath, [path.join(process.cwd(), 'test/fixtures/v93-method-chain-worker.cjs')],
      { cwd: process.cwd(), windowsHide: true, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const child: Child = { process: processChild, events: [], closed: false, exited: Promise.resolve() };
    child.exited = new Promise(resolve => processChild.once('close', () => { child.closed = true; resolve(); }));
    processChild.on('error', () => child.events.push({ event: 'CHILD_FAILED', pid: processChild.pid ?? 0 }));
    processChild.on('message', event => { child.events.push(event as ChildEvent); persist(); });
    children.push(child);
    await until(() => {
      if (child.closed || child.events.some(event => event.event === 'CHILD_FAILED')) throw new Error('METHOD_CHILD_START_FAILED');
      return child.events.some(event => event.event === 'READY');
    }, 30000);
    return child;
  }
  const get = async (id: string) => (await request(app.getHttpServer()).get(`/api/conversations/${id}`).set(auth(owner.token)).expect(200)).body;
  const report = async (id: string, messageId: string) => agentReportSchema.parse((await get(id)).messages.find((message: { id: string }) => message.id === messageId).structuredPayload.report);
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid'), target = new URL(process.env.REDIS_URL ?? 'redis://invalid');
    if (database.hostname !== '127.0.0.1' || database.port !== '3311' || !/^\/lazy_armor_v93_method_process_\d{8}_[a-f0-9]{8}_test$/.test(database.pathname)
      || database.pathname !== '/' + process.env.TEST_DATABASE_NAME || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
      || target.hostname !== '127.0.0.1' || target.port !== '6391' || target.pathname !== '/15'
      || !process.env.REDIS_KEY_PREFIX?.startsWith('v93-method-process:') || process.env.REDIS_KEY_PREFIX !== process.env.TEST_REDIS_KEY_PREFIX)
      throw new Error('Exact fresh method process target required');
    if (!evidence || existsSync(evidence)) throw new Error('Fresh process evidence required');
    if (!existsSync(path.join(process.cwd(), 'dist/agent/reports/report-method-state.js'))) throw new Error('Final API build required');
    ({ app, pool } = await bootP2App('v93-method-process-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', '隔离进程用户'); other = await register(app, randomUUID() + '@example.test', '另一隔离用户');
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue('lazy-armor-reports', { connection: redis, prefix: process.env.REDIS_KEY_PREFIX });
  });
  afterEach(async () => { for (const child of children) await stop(child); persist(); vi.restoreAllMocks(); });
  afterAll(async () => { try { for (const child of children) await stop(child); await queue?.close(); if (redis && redis.status !== 'end') await redis.quit(); await app?.close(); await pool?.end(); } finally { persist(); } });
  async function prepare() {
    const ports = (key: string) => ({ type: 'object', additionalProperties: false, properties: { [key]: { type: 'string' } }, required: [key] });
    const methods = app.get(SkillRepositoriesService);
    const imported = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), sourceType: 'USER', name: '隔离进程方法', entries: [
      { name: 'ProcessResearch', version: '1.0.0', description: '研究', domain: 'learning', input: ports('goal'), output: ports('research'), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '形成研究材料，仅为开发验收假设。' },
      { name: 'ProcessReport', version: '1.0.0', description: '报告', domain: 'learning', input: ports('research'), output: ports('report'), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '根据实际研究材料形成报告。' },
    ] });
    const repository = await methods.change(owner.userId, imported.id, 1, true);
    const refs = repository.entries.map(entry => ({ repositoryId: repository.id, repositoryVersion: repository.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }));
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', methodRefs: refs }).expect(201)).body;
    const model = app.get(ReportModelService), sections = ['目标', '条件', '风险', '学习建议'];
    vi.spyOn(model, 'plan').mockResolvedValue({ value: { title: '开发假设', prompt: '开发验收明确假设。'.repeat(20), sections, assumptions: [], researchQuestions: [], connectionIds: [] }, modelId: 'parent-fixture' });
    vi.spyOn(model, 'write').mockResolvedValue({ value: { markdown: sections.join('\n') + '学习条件为开发验收假设。'.repeat(100) }, modelId: 'parent-fixture' });
    vi.spyOn(model, 'review').mockResolvedValue({ value: { issues: [] }, modelId: 'parent-fixture' });
    const source = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ content: '生成英语学习分析报告，预算500元，仅为开发验收假设', version: 0, requestId: randomUUID() }).expect(201)).body;
    await app.get(ReportGenerationService).process(source.messages.find((message: { role: string }) => message.role === 'assistant').id);
    const research = repository.entries.find(entry => entry.manifest.name === 'ProcessResearch')!, drafting = repository.entries.find(entry => entry.manifest.name === 'ProcessReport')!;
    const graph = { version: source.version, goalBindings: [{ methodId: research.id, inputField: 'goal', goalField: 'goal' }],
      links: [{ fromMethodId: research.id, outputField: 'research', toMethodId: drafting.id, inputField: 'research' }], deliveries: [{ methodId: drafting.id, outputField: 'report', label: '学习建议' }] };
    const preview = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-preview`).set(auth(owner.token)).send({ graph }).expect(201)).body;
    expect(preview.state).toBe('STRUCTURE_VALID');
    const requestId = randomUUID(), selection = { graph, basis: { goalBriefRef: preview.goalBriefRef, methodRefs: preview.methodRefs, sourceMessageRefs: preview.sourceMessageRefs } };
    const accepted = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-authoring`).set(auth(owner.token)).send({ requestId, selection }).expect(201)).body;
    await app.get(AuthoringJobsService).process(accepted.authoringJobs.at(-1).jobId);
    const queued = await get(created.id), message = queued.messages.find((message: { role: string; requestId: string }) => message.role === 'assistant' && message.requestId === requestId);
    return { conversationId: created.id as string, messageId: message.id as string, requestId, selection };
  }
  it.each(['BLOCK_SECOND', 'BLOCK_WRITE', 'TAMPER'] as const)('recovers or rejects the saved prefix after a hard process exit: %s', async mode => {
    const flow = await prepare();
    const first = await start(mode === 'BLOCK_WRITE' ? 'BLOCK_WRITE' : 'BLOCK_SECOND');
    await until(() => first.events.some(event => mode === 'BLOCK_WRITE' ? event.event === 'WRITE' : event.event === 'METHOD' && event.name === 'ProcessReport'), 30000);
    const interrupted = await report(flow.conversationId, flow.messageId);
    expect(interrupted.methodRuns).toHaveLength(mode === 'BLOCK_WRITE' ? 2 : 1);
    expect(interrupted.stage).toBe(mode === 'BLOCK_WRITE' ? 'WRITING' : 'COMPOSING');
    await stop(first);
    if (mode === 'TAMPER') {
      const changed: AgentReport = { ...interrupted, methodRuns: interrupted.methodRuns!.map((run, index) => index ? run : { ...run, outputs: { research: '篡改的开发产物' } }) };
      // Only this fresh isolated message is altered; no lease, clock or queue lock changes.
      await pool.execute("UPDATE consumer_messages SET structured_payload=JSON_SET(structured_payload,'$.report',CAST(? AS JSON)) WHERE id=UUID_TO_BIN(?)", [JSON.stringify(changed), flow.messageId]);
    }
    const second = await start('FINISH');
    await until(async () => ['COMPLETED', 'FAILED'].includes((await report(flow.conversationId, flow.messageId)).stage));
    await until(async () => !await queue.getJob(flow.messageId));
    const final = await report(flow.conversationId, flow.messageId);
    const modelEvents = second.events.filter(event => ['PLAN', 'METHOD', 'WRITE', 'REVIEW'].includes(event.event));
    if (mode === 'TAMPER') {
      expect(final).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_METHOD_STATE_INVALID' }); expect(modelEvents).toHaveLength(0);
    } else {
      expect(final.stage).toBe('COMPLETED'); expect(final.methodRuns).toHaveLength(2);
      expect(final.methodRuns!.slice(0, interrupted.methodRuns!.length)).toEqual(interrupted.methodRuns);
      expect(final.plan).toEqual(interrupted.plan); expect(final.sources).toEqual(interrupted.sources);
      expect(final.methodRuns![1].inputs.research).toBe(final.methodRuns![0].outputs.research);
      expect(modelEvents.filter(event => event.event === 'PLAN' || event.name === 'ProcessResearch')).toHaveLength(0);
      expect(modelEvents.filter(event => event.event === 'METHOD')).toHaveLength(mode === 'BLOCK_WRITE' ? 0 : 1);
      expect(final.budget!.modelCalls).toBe(interrupted.budget!.modelCalls + (mode === 'BLOCK_WRITE' ? 2 : 3));
      expect(final.budget!.deadlineAt).toBe(interrupted.budget!.deadlineAt);
      expect(modelEvents.find(event => event.event === 'WRITE')?.savedMethods).toBe(2);
      const beforeReplay = modelEvents.length;
      await request(app.getHttpServer()).post(`/api/conversations/${flow.conversationId}/composition-authoring`).set(auth(owner.token)).send({ requestId: flow.requestId, selection: flow.selection }).expect(201);
      await queue.add('generate-report', { messageId: flow.messageId }, { jobId: flow.messageId, removeOnComplete: true, removeOnFail: true });
      await until(async () => !await queue.getJob(flow.messageId));
      expect(second.events.filter(event => ['PLAN', 'METHOD', 'WRITE', 'REVIEW'].includes(event.event))).toHaveLength(beforeReplay);
    }
    await request(app.getHttpServer()).get(`/api/conversations/${flow.conversationId}`).set(auth(other.token)).expect(404);
    const [counts] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', Array(3).fill(owner.userId));
    expect(counts[0]).toMatchObject({ plans: 0, executions: 0, truths: 0 });
    expect(children.flatMap(child => child.events).some(event => event.event === 'NETWORK_ATTEMPT')).toBe(false);
    records.push({ mode, passed: true, firstPid: first.process.pid, secondPid: second.process.pid, savedMethods: interrupted.methodRuns!.length, restoredStage: final.stage,
      interruptedCalls: interrupted.budget!.modelCalls, finalCalls: final.budget!.modelCalls, deadlineRetained: final.budget!.deadlineAt === interrupted.budget!.deadlineAt, counts: counts[0] });
    persist();
  });
});
