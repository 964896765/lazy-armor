import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { TaskGraphProjection } from '@lazy-armor/plan-schema';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';
import { ExecutionStateService } from '../src/execution/execution-state.service';
import { ExecutionStepStateService } from '../src/execution/execution-step-state.service';
import { ExecutionQueueReconciler } from '../src/execution/execution-queue-reconciler.service';
import { RuntimeTaskScheduler } from '../src/agent/tasks/task-scheduler.service';
import { QueueService } from '../src/infrastructure/queue.service';
import { executionOwnerContext } from '../src/execution/execution-owner-context';

const definition = (name: string) => ({ name, domain: 'general', automationLevel: 'L1',
  sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
  conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 10, sortOrder: 0 }],
  actions: [{ actionType: 'compare', config: {}, stepOrder: 0 }, { actionType: 'compare', config: {}, stepOrder: 1 }] });

/** Test-only Plans/reads on isolated MySQL; this is not real mobile acceptance. */
describe.sequential('Agent Task foundation on existing fenced Runtime', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, stranger: Session;
  let worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  let planId: string, versionId: string;
  const unique = randomUUID();
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
    if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated *_test DB required');
    ({ app, pool, worker } = await bootP2App('agent-tasks-' + unique));
    owner = await register(app, unique + '@example.test', 'Task owner');
    stranger = await register(app, 'other-' + unique + '@example.test', 'Other owner');
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(definition('任务基础测试')).expect(201);
    planId = plan.body.id;
    await activatePlan(app, owner.token, planId);
    versionId = (await request(app.getHttpServer()).get('/api/plans/' + planId).set(auth(owner.token)).expect(200)).body.activeVersionId;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function dispatch(requestId = randomUUID()) {
    return (await request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(owner.token)).send({ requestId, triggerPayload: { amount: 20 } }).expect(201)).body;
  }
  async function graph(executionId: string): Promise<TaskGraphProjection> {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM agent_task_graphs WHERE execution_id=UUID_TO_BIN(?)', [executionId]);
    expect(rows).toHaveLength(1);
    return (await request(app.getHttpServer()).get('/api/task-graphs/' + rows[0].id).set(auth(owner.token)).expect(200)).body;
  }
  it('creates one graph and ordered dependencies from the frozen confirmed version; simultaneous replay keeps identities', async () => {
    const requestId = randomUUID();
    const runs = await Promise.all([dispatch(requestId), dispatch(requestId), dispatch(requestId)]);
    expect(new Set(runs.map(run => run.id)).size).toBe(1);
    const g = await graph(runs[0].id);
    expect(g).toMatchObject({ planId, planVersionId: versionId, status: 'READY', recordedStatus: 'READY' });
    expect(g.tasks).toHaveLength(3);
    expect(g.tasks[1]).toMatchObject({ parentTaskId: g.tasks[0].id, status: 'READY', dependsOn: [] });
    expect(g.tasks[2]).toMatchObject({ status: 'WAITING', waitReason: 'DEPENDENCY', dependsOn: [g.tasks[1].id] });
    expect((await graph((await dispatch(requestId)).id)).tasks.map(t => t.id)).toEqual(g.tasks.map(t => t.id));
  });
  it('enforces ownership, read-only endpoints and bounded history cursors', async () => {
    const g = await graph((await dispatch()).id);
    await request(app.getHttpServer()).get('/api/task-graphs/' + g.id).set(auth(stranger.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/plans/${planId}/task-graphs`).set(auth(stranger.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/plans/${planId}/task-graphs?limit=101`).set(auth(owner.token)).expect(400);
    await request(app.getHttpServer()).post('/api/task-graphs/' + g.id).set(auth(owner.token)).send({ status: 'RUNNING' }).expect(404);
    const first = (await request(app.getHttpServer()).get(`/api/plans/${planId}/task-graphs?limit=1`).set(auth(owner.token)).expect(200)).body;
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const next = (await request(app.getHttpServer()).get(`/api/plans/${planId}/task-graphs?limit=1&cursor=${first.nextCursor}`).set(auth(owner.token)).expect(200)).body;
    expect(next.items[0].id).not.toBe(first.items[0].id);
  });
  it('runs different executions concurrently through the same worker and keeps Task/Execution identity', async () => {
    const runs = await Promise.all([dispatch(), dispatch()]);
    await Promise.all(runs.map(run => worker.processExecution(run.id)));
    for (const run of runs) {
      const g = await graph(run.id);
      expect(g.status).toBe('SUCCESS');
      expect(g.tasks.every(t => t.status === 'SUCCESS' && t.recordedStatus === 'SUCCESS')).toBe(true);
      expect(g.executionId).toBe(run.id);
    }
  });
  it('rejects stale holder completion and step changes without contaminating tasks', async () => {
    const run = await dispatch(); const before = await graph(run.id);
    await pool.query("UPDATE executions SET worker_token='current-token',lease_expires_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 SECOND) WHERE id=UUID_TO_BIN(?)", [run.id]);
    const stale = (body: () => Promise<unknown>) => executionOwnerContext.run({ executionId: run.id, workerToken: 'stale-token' }, body);
    await expect(stale(() => app.get(ExecutionStateService).transition(run.id, 'failed'))).rejects.toThrow('STALE_EXECUTION_LEASE');
    await expect(stale(() => app.get(ExecutionStepStateService).transition(before.tasks[1].executionStepId!, 'failed'))).rejects.toThrow('STALE_EXECUTION_LEASE');
    expect(await graph(run.id)).toEqual(before);
  });
  it('recovers queue admission failure without a second graph or new task identities', async () => {
    app.get(QueueService).failNextEnqueueForTest();
    const run = await dispatch(); const before = await graph(run.id);
    expect(run.status).toBe('created');
    await app.get(ExecutionQueueReconciler).reconcile(new Date(Date.now() + 1000));
    const after = await graph(run.id);
    expect(after.status).toBe('READY');
    expect(after.tasks.map(t => t.id)).toEqual(before.tasks.map(t => t.id));
    await worker.processExecution(run.id);
    expect((await graph(run.id)).status).toBe('SUCCESS');
  });
  it('preserves UNKNOWN snapshots and blocks scheduler replay of uncertain work', async () => {
    const run = await dispatch(); const g = await graph(run.id);
    await app.get(ExecutionStateService).transition(run.id, 'running');
    await app.get(ExecutionStepStateService).transition(g.tasks[1].executionStepId!, 'failed', { errorCode: 'OUTCOME_UNKNOWN' });
    await app.get(ExecutionStateService).transition(run.id, 'failed', { errorCode: 'OUTCOME_UNKNOWN' });
    const unknown = await graph(run.id);
    expect(unknown.status).toBe('UNKNOWN'); expect(unknown.recordedStatus).toBe('UNKNOWN');
    await expect(app.get(RuntimeTaskScheduler).enqueueExecution(run.id)).rejects.toThrow('TASK_OUTCOME_UNKNOWN_REQUIRES_RECONCILIATION');
    await expect(app.get(ExecutionStateService).transition(run.id, 'queued')).rejects.toThrow('Terminal Execution');
    expect(await graph(run.id)).toEqual(unknown);
  });
  it('cancels queued work through the original API and closes unstarted Tasks without an effect',async()=>{
    const run=await dispatch(),before=await graph(run.id);
    await request(app.getHttpServer()).post('/api/executions/'+run.id+'/cancel').set(auth(owner.token)).send({}).expect(201);
    const cancelled=await graph(run.id);
    expect(cancelled).toMatchObject({status:'CANCELLED',recordedStatus:'CANCELLED',runtimeStatus:'cancelled'});
    expect(cancelled.tasks.map(task=>task.id)).toEqual(before.tasks.map(task=>task.id));
    expect(cancelled.tasks.every(task=>task.status==='CANCELLED'&&task.recordedStatus==='CANCELLED'&&task.waitReason===null)).toBe(true);
    await worker.processExecution(run.id); expect(await graph(run.id)).toEqual(cancelled);
    const [effects]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',[run.id]);expect(effects[0].n).toBe(0);
  });
  it('marks dependent unstarted Tasks as stopped when an earlier step fails',async()=>{
    const run=await dispatch(),before=await graph(run.id);
    await app.get(ExecutionStepStateService).transition(before.tasks[1].executionStepId!,'failed',{errorCode:'INVALID_INPUT'});
    await app.get(ExecutionStateService).transition(run.id,'failed',{errorCode:'INVALID_INPUT'});
    const failed=await graph(run.id);
    expect(failed).toMatchObject({status:'FAILED',recordedStatus:'FAILED'});
    expect(failed.tasks[2]).toMatchObject({status:'FAILED',recordedStatus:'FAILED',runtimeStatus:'pending',waitReason:null,retryCount:0});
  });
  it('task insertion failure rolls back the entire authorized dispatch', async () => {
    const requestId = randomUUID();
    await pool.query("CREATE TRIGGER agent_task_test_failure BEFORE INSERT ON agent_tasks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='task insert fixture failure'");
    try { await request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(owner.token)).send({ requestId, triggerPayload: { amount: 20 } }).expect(500); }
    finally { await pool.query('DROP TRIGGER agent_task_test_failure'); }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM executions WHERE user_id=UUID_TO_BIN(?) AND request_id=?', [owner.userId, requestId]);
    expect(rows).toHaveLength(0);
  });
  it('Plan edits/pause preserve frozen graph ownership and history', async () => {
    const run = await dispatch(); const before = await graph(run.id);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(owner.token)).send(definition('新的计划名称')).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/2/apply`).set(auth(owner.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(owner.token)).send({ status: 'paused' }).expect(201);
    const after = await graph(run.id);
    expect(after.planPaused).toBe(true); expect(after.historical).toBe(true); expect(after.planVersionId).toBe(before.planVersionId);
    expect(after.tasks).toEqual(before.tasks);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(owner.token)).send({ status: 'active' }).expect(201);
  });
});
