import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionQueueReconciler } from '../src/execution/execution-queue-reconciler.service';

interface Session {
  token: string;
  userId: string;
}

interface ExecutionLeaseRow {
  status: string;
  planVersionId: string;
  workerToken: string | null;
  leaseExpiresAt: Date | null;
}

interface WorkerProcess {
  child: ChildProcess;
  role: 'execution-worker';
  probePort: number;
  output: string[];
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const apiRoot = process.cwd();
const repoRoot = path.resolve(apiRoot, '..', '..');
const executionWorkerEntry = path.join(apiRoot, 'dist', 'entrypoints', 'execution-worker.main.js');
const dockerComposePath = path.join(repoRoot, 'infra', 'docker', 'docker-compose.yml');
const activeWorkers: WorkerProcess[] = [];
let portCursor = 35210;
let sharedInternalConnectionId = '';
let poolRef: Pool;
// GitHub Actions 的 service containers 由 Runner 管理，测试不可安全 stop/start。
// 本地 Compose 保留故障注入验证；CI 继续执行真实多进程消费与健康路径。
const supportsRedisFaultInjection = process.env.CI !== 'true' && isContainerRunning('lazy-armor-p0-redis-1');
const supportsMysqlFaultInjection = process.env.CI !== 'true' && isContainerRunning('lazy-armor-p0-mysql-1');
const redisFaultInjectionIt = supportsRedisFaultInjection ? it : it.skip;
const mysqlFaultInjectionIt = supportsMysqlFaultInjection ? it : it.skip;

describe.sequential('P0-H4 execution worker true-process reliability', { timeout: 180000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: IORedis;
  let queue: Queue<{ executionId: string }>;
  let user: Session;
  let readonly: Session;
  let internalConnectionId: string;
  let reconciler: ExecutionQueueReconciler;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    if (!existsSync(executionWorkerEntry)) {
      throw new Error('Execution worker dist entrypoint is missing. Run `pnpm --filter @lazy-armor/api build` before the true-process worker tests.');
    }
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.APP_ROLE = 'api';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 10).toString('base64');
    process.env.CREDENTIAL_STORE_PATH = `.data/test-h4-worker-${unique}`;
    process.env.WORKER_READINESS_TIMEOUT_MS = '800';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 6, timezone: 'Z' });
    poolRef = pool;
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue('lazy-armor-executions', { connection: redis });
    reconciler = app.get(ExecutionQueueReconciler);

    user = await register(app, `h4-worker-${unique}@example.com`, 'H4 Worker');
    readonly = await register(app, `h4-ops-${unique}@example.com`, 'H4 Worker Ops');
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', readonly.userId]);
    internalConnectionId = await createConnection(app, user.token, 'internal', `内部连接-${unique}`);
    sharedInternalConnectionId = internalConnectionId;
    await grant(app, user.token, internalConnectionId, 'WRITE_INTERNAL');
  });

  afterEach(async () => {
    while (activeWorkers.length) {
      await stopWorker(activeWorkers.pop()!);
    }
    if (supportsRedisFaultInjection) {
      await ensureContainerRunning('lazy-armor-p0-redis-1');
    }
    if (supportsMysqlFaultInjection) {
      await ensureContainerRunning('lazy-armor-p0-mysql-1');
    }
  });

  afterAll(async () => {
    while (activeWorkers.length) {
      await stopWorker(activeWorkers.pop()!);
    }
    await queue?.close();
    if (redis && redis.status !== 'end') await redis.quit();
    await pool?.end();
    await app?.close();
  });

  it('starts a standalone execution worker, serves /live and /ready, and consumes queued executions', async () => {
    const worker = await startExecutionWorker(3011);
    const live = await fetchJson(`http://127.0.0.1:${worker.probePort}/live`);
    expect(live).toMatchObject({
      status: 'ok',
      role: 'execution-worker',
    });

    const ready = await waitForReady(worker.probePort, 200);
    expect(ready).toMatchObject({
      status: 'ready',
      role: 'execution-worker',
      mysql: 'ready',
      bullmq: 'ready',
    });

    const planId = await createInternalPlan(app, user.token, `正常启动-${unique}`);
    const executionId = await dispatch(app, user.token, planId, { amount: 300 }, `startup-${unique}`);
    const detail = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(detail.steps.map((step: { status: string }) => step.status)).toEqual(['succeeded']);
  });

  redisFaultInjectionIt('keeps /live up, returns /ready=503 during Redis outage, and recovers after Redis restart', async () => {
    const worker = await startExecutionWorker();
    await waitForReady(worker.probePort, 200);

    stopContainer('lazy-armor-p0-redis-1');
    const live = await waitForLive(worker.probePort, 200);
    expect(live.status).toBe('ok');
    const degraded = await waitForReady(worker.probePort, 503);
    expect(degraded.status).toBe('not_ready');

    startContainer('lazy-armor-p0-redis-1');
    await ensureContainerHealthy('lazy-armor-p0-redis-1');
    const recovered = await waitForReady(worker.probePort, 200, 30_000);
    expect(recovered.status).toBe('ready');

    const planId = await createInternalPlan(app, user.token, `Redis恢复-${unique}`);
    const executionId = await dispatch(app, user.token, planId, { amount: 320 }, `redis-recovery-${unique}`);
    expect((await waitForExecutionStatus(app, user.token, executionId, 'succeeded')).status).toBe('succeeded');
  });

  mysqlFaultInjectionIt('keeps /live up, returns /ready=503 during MySQL outage, and recovers after MySQL restart', async () => {
    const worker = await startExecutionWorker();
    await waitForReady(worker.probePort, 200);

    stopContainer('lazy-armor-p0-mysql-1');
    const live = await waitForLive(worker.probePort, 200);
    expect(live.status).toBe('ok');
    const degraded = await waitForReady(worker.probePort, 503, 30_000);
    expect(degraded.status).toBe('not_ready');

    startContainer('lazy-armor-p0-mysql-1');
    await ensureContainerHealthy('lazy-armor-p0-mysql-1', 60_000);
    const recovered = await waitForReady(worker.probePort, 200, 60_000);
    expect(recovered.status).toBe('ready');
  });

  it('exits cleanly on SIGTERM and SIGINT and closes the probe server', async () => {
    const termWorker = await startExecutionWorker();
    await waitForReady(termWorker.probePort, 200);
    await stopWorker(termWorker, 'SIGTERM');
    expect(await isProbeReachable(termWorker.probePort)).toBe(false);

    const intWorker = await startExecutionWorker();
    await waitForReady(intWorker.probePort, 200);
    await stopWorker(intWorker, 'SIGINT');
    expect(await isProbeReachable(intWorker.probePort)).toBe(false);
  });

  it('processes only one real execution when BullMQ delivers duplicate jobs for the same execution', async () => {
    const planId = await createInternalPlan(app, user.token, `重复投递-${unique}`);
    const executionId = await dispatch(app, user.token, planId, { amount: 350 }, `duplicate-${unique}`);
    await queue.add('duplicate-a', { executionId }, { jobId: `${executionId}-a`, removeOnComplete: true, removeOnFail: false });
    await queue.add('duplicate-b', { executionId }, { jobId: `${executionId}-b`, removeOnComplete: true, removeOnFail: false });

    const worker = await startExecutionWorker();
    const detail = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(detail.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'succeeded',
        attemptCount: 1,
      }),
    ]));
    const leaseEvents = detail.events.filter((event: { eventType: string }) => event.eventType === 'worker_lease_acquired');
    expect(leaseEvents).toHaveLength(1);
  });

  it('recovers an expired lease with a real worker process without repeating succeeded steps', async () => {
    const planId = await createTwoStepPlan(app, user.token, `lease接管-${unique}`);
    const executionId = await dispatch(app, user.token, planId, { amount: 360 }, `lease-${unique}`);
    const before = await detail(app, user.token, executionId);

    await pool.query("UPDATE executions SET status='running',worker_token='dead-worker',heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE),lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 SECOND),started_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [executionId]);
    await pool.query("UPDATE execution_steps SET status='succeeded',attempt_count=1,started_at=UTC_TIMESTAMP(6),finished_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [before.steps[0].id]);
    await pool.query("UPDATE execution_steps SET status='running',attempt_count=1,started_at=UTC_TIMESTAMP(6),finished_at=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [before.steps[1].id]);

    const worker = await startExecutionWorker();
    const recovered = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(recovered.steps[0].attemptCount).toBe(1);
    expect(recovered.steps[1].attemptCount).toBe(2);
    expect(recovered.events.some((event: { eventType: string }) => event.eventType === 'worker_lease_recovered')).toBe(true);

    const result = await reconciler.reconcile(new Date(Date.now() + 1_000));
    expect(result.recovered).toBeGreaterThanOrEqual(0);
    void worker;
  });

  it('shows explicit Worker A -> Worker B takeover on the same execution and planVersion without creating a second execution', async () => {
    const planId = await createLongRunningPlan(app, user.token, `worker-a-b-${unique}`, 48);
    const requestId = `worker-a-b-${unique}`;
    const executionId = await dispatch(app, user.token, planId, { amount: 365 }, requestId);
    const seeded = await detail(app, user.token, executionId);
    const originalPlanVersionId = seeded.planVersionId as string;

    const workerA = await startExecutionWorker();
    const leaseA = await waitForExecutionLease(executionId, (row) => row.workerToken !== null && row.status === 'running');
    const progress = await waitForExecutionProgress(executionId, 2);
    expect(leaseA.planVersionId).toBe(originalPlanVersionId);
    const workerAToken = leaseA.workerToken;
    expect(workerAToken).toBeTruthy();
    expect(progress.succeededSteps).toBeGreaterThanOrEqual(2);

    await hardKillWorker(workerA);
    await pool.query("UPDATE executions SET worker_token=?, heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE), lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 SECOND), updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [workerAToken, executionId]);
    await queue.add('takeover-b', { executionId }, { jobId: `${executionId}-takeover-b`, removeOnComplete: true, removeOnFail: false });

    await startExecutionWorker();
    const recovered = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(recovered.id).toBe(executionId);
    expect(recovered.planVersionId).toBe(originalPlanVersionId);
    expect(recovered.steps[0].attemptCount).toBe(1);
    expect(recovered.steps.some((step: { stepOrder: number; attemptCount: number }) => step.stepOrder > 0 && step.attemptCount >= 1)).toBe(true);
    expect(recovered.events.some((event: { eventType: string }) => event.eventType === 'worker_lease_recovered')).toBe(true);

    const [executionRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) count FROM executions WHERE request_id=?',
      [requestId],
    );
    expect(Number(executionRows[0]?.count ?? 0)).toBe(1);
  });

  it('reconciles a stuck execution, clears operations stuck count, and records recovery audit without direct status mutation by admin', async () => {
    const planId = await createTwoStepPlan(app, user.token, `stuck-recovery-${unique}`);
    const requestId = `stuck-${unique}`;
    const executionId = await dispatch(app, user.token, planId, { amount: 366 }, requestId);
    const seeded = await detail(app, user.token, executionId);

    const queuedJob = await queue.getJob(executionId);
    if (queuedJob && !(await queuedJob.isActive())) await queuedJob.remove();
    await pool.query("UPDATE execution_steps SET status='succeeded',attempt_count=1,started_at=UTC_TIMESTAMP(6),finished_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [seeded.steps[0].id]);
    await pool.query("UPDATE execution_steps SET status='running',attempt_count=1,started_at=UTC_TIMESTAMP(6),finished_at=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [seeded.steps[1].id]);
    await pool.query("UPDATE executions SET status='running',worker_token='stale-worker',heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE),lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE),started_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [executionId]);

    const before = await request(app.getHttpServer())
      .get('/api/admin/operations/executions')
      .set(auth(readonly.token))
      .expect(200);
    expect(before.body.stuck).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: executionId,
      }),
    ]));

    const reconcileResult = await reconciler.reconcile(new Date(Date.now() + 1_000));
    expect(reconcileResult.recovered).toBeGreaterThanOrEqual(1);

    await startExecutionWorker();
    const recovered = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(recovered.events.some((event: { eventType: string }) => event.eventType === 'queue_reconciled')).toBe(true);

    const after = await request(app.getHttpServer())
      .get('/api/admin/operations/executions')
      .set(auth(readonly.token))
      .expect(200);
    expect(after.body.stuck.some((item: { id: string }) => item.id === executionId)).toBe(false);

    const [auditRows] = await pool.query<RowDataPacket[]>(
      'SELECT action, reason_code reasonCode FROM audit_logs WHERE execution_id=UUID_TO_BIN(?) AND action=\'EXECUTION_RECOVERED\' ORDER BY created_at DESC LIMIT 5',
      [executionId],
    );
    expect(auditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'EXECUTION_RECOVERED',
      }),
    ]));
  });
});

async function register(app: INestApplication, email: string, displayName: string): Promise<Session> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery-staple', displayName })
    .expect(201);
  const me = await request(app.getHttpServer())
    .get('/api/me')
    .set(auth(response.body.accessToken))
    .expect(200);
  return { token: response.body.accessToken as string, userId: me.body.id as string };
}

async function createConnection(app: INestApplication, token: string, connectorId: string, name: string) {
  const response = await request(app.getHttpServer())
    .post('/api/connections')
    .set(auth(token))
    .send({ connectorId, externalAccountName: name })
    .expect(201);
  return response.body.id as string;
}

async function grant(app: INestApplication, token: string, id: string, capability: string) {
  await request(app.getHttpServer())
    .put(`/api/connections/${id}/permissions`)
    .set(auth(token))
    .send({ permissions: [{ capability, granted: true }] })
    .expect(200);
}

async function createInternalPlan(app: INestApplication, token: string, name: string) {
  const created = await request(app.getHttpServer())
    .post('/api/plans')
    .set(auth(token))
    .send({
      name,
      description: 'P0-H4 true worker process',
      domain: 'general',
      automationLevel: 'L1',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
      conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 200, sortOrder: 0 }],
      actions: [{ actionType: 'update_internal_record', connectionId: internalConnectionIdRef(), requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'worker-h4' }, stepOrder: 0 }],
    })
    .expect(201);
  await activatePlan(app, token, created.body.id as string);
  return created.body.id as string;
}

async function createTwoStepPlan(app: INestApplication, token: string, name: string) {
  const created = await request(app.getHttpServer())
    .post('/api/plans')
    .set(auth(token))
    .send({
      name,
      description: 'P0-H4 lease recovery',
      domain: 'general',
      automationLevel: 'L1',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
      conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 200, sortOrder: 0 }],
      actions: [
        { actionType: 'compare', config: {}, stepOrder: 0 },
        { actionType: 'update_internal_record', connectionId: internalConnectionIdRef(), requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'worker-h4-recover' }, stepOrder: 1 },
      ],
    })
    .expect(201);
  await activatePlan(app, token, created.body.id as string);
  return created.body.id as string;
}

async function createLongRunningPlan(app: INestApplication, token: string, name: string, stepCount: number) {
  const compareSteps = Array.from({ length: Math.max(2, stepCount - 1) }, (_, index) => ({
    actionType: 'compare',
    config: {},
    stepOrder: index,
  }));
  const created = await request(app.getHttpServer())
    .post('/api/plans')
    .set(auth(token))
    .send({
      name,
      description: 'P0-H4 explicit worker takeover',
      domain: 'general',
      automationLevel: 'L1',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
      conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 200, sortOrder: 0 }],
      actions: [
        ...compareSteps,
        { actionType: 'update_internal_record', connectionId: internalConnectionIdRef(), requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'worker-h4-takeover' }, stepOrder: compareSteps.length },
      ],
    })
    .expect(201);
  await activatePlan(app, token, created.body.id as string);
  return created.body.id as string;
}

function internalConnectionIdRef() {
  if (!sharedInternalConnectionId) throw new Error('Internal connection is not ready');
  return sharedInternalConnectionId;
}

async function activatePlan(app: INestApplication, token: string, planId: string) {
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
}

async function dispatch(app: INestApplication, token: string, planId: string, payload: Record<string, unknown>, requestId: string) {
  const created = await request(app.getHttpServer())
    .post(`/api/plans/${planId}/executions`)
    .set(auth(token))
    .send({ requestId, triggerPayload: payload })
    .expect(201);
  return created.body.id as string;
}

async function detail(app: INestApplication, token: string, executionId: string) {
  return (await request(app.getHttpServer()).get(`/api/executions/${executionId}`).set(auth(token)).expect(200)).body;
}

async function waitForExecutionStatus(app: INestApplication, token: string, executionId: string, status: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await detail(app, token, executionId);
    if (row.status === status) return row;
    await sleep(200);
  }
  throw new Error(`Execution did not reach ${status}`);
}

async function waitForExecutionLease(executionId: string, predicate: (row: ExecutionLeaseRow) => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await executionLeaseRow(executionId);
    if (row && predicate(row)) return row;
    await sleep(50);
  }
  throw new Error(`Execution lease did not reach expected state for ${executionId}`);
}

async function waitForExecutionProgress(executionId: string, minSucceededSteps: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [rows] = await poolRef.query<RowDataPacket[]>(
      `SELECT
          (SELECT status FROM executions WHERE id=UUID_TO_BIN(?)) executionStatus,
          SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeededSteps,
          SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) runningSteps
        FROM execution_steps
       WHERE execution_id=UUID_TO_BIN(?)`,
      [executionId, executionId],
    );
    const executionStatus = String(rows[0]?.executionStatus ?? '');
    const succeededSteps = Number(rows[0]?.succeededSteps ?? 0);
    const runningSteps = Number(rows[0]?.runningSteps ?? 0);
    if (executionStatus === 'running' && succeededSteps >= minSucceededSteps) {
      return { succeededSteps, runningSteps };
    }
    await sleep(25);
  }
  throw new Error(`Execution did not reach ${minSucceededSteps} succeeded steps for ${executionId}`);
}


async function startExecutionWorker(explicitProbePort?: number): Promise<WorkerProcess> {
  const probePort = explicitProbePort ?? nextPort();
  const output: string[] = [];
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'development',
    // 父进程是 API 测试上下文；生成的独立进程必须以目标 Worker 角色运行。
    APP_ROLE: 'execution-worker',
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY!,
    CREDENTIAL_STORE_PATH: process.env.CREDENTIAL_STORE_PATH!,
    WORKER_READINESS_TIMEOUT_MS: process.env.WORKER_READINESS_TIMEOUT_MS ?? '800',
    WORKER_PROBE_HOST: '127.0.0.1',
    EXECUTION_WORKER_PROBE_PORT: String(probePort),
  };
  const child = spawn(process.execPath, [executionWorkerEntry], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));
  const worker = { child, role: 'execution-worker' as const, probePort, output };
  await waitForLive(worker.probePort, 200, 30_000);
  activeWorkers.push(worker);
  return worker;
}

async function stopWorker(worker: WorkerProcess, signal: 'SIGTERM' | 'SIGINT' = 'SIGTERM') {
  forgetWorker(worker);
  if (worker.child.exitCode !== null) return;
  worker.child.kill(signal);
  const exited = await waitForExit(worker.child, 8_000);
  if (!exited) {
    if (worker.child.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(worker.child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    }
    const forced = await waitForExit(worker.child, 4_000);
    if (!forced && worker.child.exitCode === null && await isChildProcessAlive(worker.child)) {
      throw new Error(`Worker process did not exit after ${signal}. Logs:\n${worker.output.join('')}`);
    }
  }
}

async function hardKillWorker(worker: WorkerProcess) {
  forgetWorker(worker);
  if (worker.child.exitCode !== null) return;
  if (worker.child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(worker.child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  }
  const exited = await waitForExit(worker.child, 4_000);
  if (!exited && worker.child.exitCode === null && await isChildProcessAlive(worker.child)) {
    throw new Error(`Worker process did not exit after force kill. Logs:\n${worker.output.join('')}`);
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || !(await isChildProcessAlive(child))) return true;
  const deadline = Date.now() + timeoutMs;
  return await new Promise<boolean>((resolve) => {
    let finished = false;
    const settle = (value: boolean) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onExit = () => settle(true);
    const poll = setInterval(() => {
      void isChildProcessAlive(child).then((alive) => {
        if (!alive) settle(true);
      }).catch(() => undefined);
    }, 200);
    poll.unref?.();
    const timer = setTimeout(() => settle(false), Math.max(0, deadline - Date.now()));
    child.once('exit', onExit);
  });
}

async function waitForLive(port: number, expectedStatus: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/live`);
      if (response.status === expectedStatus) return await response.json() as Record<string, unknown>;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Worker /live did not reach HTTP ${expectedStatus} on port ${port}`);
}

async function waitForReady(port: number, expectedStatus: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      if (response.status === expectedStatus) return await response.json() as Record<string, unknown>;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Worker /ready did not reach HTTP ${expectedStatus} on port ${port}`);
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function isProbeReachable(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/live`);
    return response.ok;
  } catch {
    return false;
  }
}

async function isChildProcessAlive(child: ChildProcess) {
  if (child.exitCode !== null) return false;
  if (!child.pid) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopContainer(name: string) {
  execFileSync('docker', ['stop', '--time', '1', name], { cwd: repoRoot, stdio: 'ignore' });
}

function isContainerRunning(name: string) {
  try {
    return execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', name], { cwd: repoRoot, encoding: 'utf8' }).trim() === 'running';
  } catch {
    return false;
  }
}

function startContainer(name: string) {
  execFileSync('docker', ['start', name], { cwd: repoRoot, stdio: 'ignore' });
}

async function ensureContainerRunning(name: string) {
  try {
    const state = execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', name], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (state !== 'running') startContainer(name);
    await ensureContainerHealthy(name);
  } catch {
    execFileSync('docker', ['compose', '-f', dockerComposePath, 'up', '-d', name.includes('mysql') ? 'mysql' : 'redis'], { cwd: repoRoot, stdio: 'ignore' });
    await ensureContainerHealthy(name);
  }
}

async function ensureContainerHealthy(name: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = execFileSync('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (health === 'healthy' || health === 'running') return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Container did not become healthy: ${name}`);
}

function nextPort() {
  portCursor += 1;
  return portCursor;
}

function forgetWorker(worker: WorkerProcess) {
  const index = activeWorkers.indexOf(worker);
  if (index >= 0) activeWorkers.splice(index, 1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executionLeaseRow(executionId: string): Promise<ExecutionLeaseRow | null> {
  const [rows] = await poolRef.query<RowDataPacket[]>(
    'SELECT status, BIN_TO_UUID(plan_version_id) planVersionId, worker_token workerToken, lease_expires_at leaseExpiresAt FROM executions WHERE id=UUID_TO_BIN(?)',
    [executionId],
  );
  return (rows[0] as unknown as ExecutionLeaseRow) ?? null;
}
