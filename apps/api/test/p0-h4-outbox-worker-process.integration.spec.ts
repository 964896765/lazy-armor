import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProviderCircuitBreakerService } from '../src/infrastructure/provider-circuit-breaker.service';
import { AdminOperationsService } from '../src/admin/admin-operations.service';

interface Session {
  token: string;
  userId: string;
}

interface WorkerProcess {
  child: ChildProcess;
  role: 'outbox-worker';
  probePort: number;
  output: string[];
}

interface WorkerFacade {
  processExecution(id: string): Promise<{ status: string }>;
}

interface OutboxRow {
  id: string;
  aggregateId: string;
  status: string;
  attemptCount: number;
  dedupeKey: string;
  lastErrorCode: string | null;
}

interface OperationRow {
  id: string;
  status: string;
  idempotencyKey: string;
  errorCode: string | null;
}

interface ApprovalRow {
  id: string;
  executionId: string;
}

interface HarnessState {
  appliedKeys: string[];
  sideEffects: Record<string, number>;
  receivedKeys: Record<string, string[]>;
  callCounts: Record<string, number>;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const apiRoot = process.cwd();
const repoRoot = path.resolve(apiRoot, '..', '..');
const outboxWorkerEntry = path.join(apiRoot, 'dist', 'entrypoints', 'outbox-worker.main.js');
const dockerComposePath = path.join(repoRoot, 'infra', 'docker', 'docker-compose.yml');
const activeWorkers: WorkerProcess[] = [];
const harnessStatePath = path.join(repoRoot, '.data', 'true-process-outbox-harness-state.json');
let portCursor = 35320;
let sharedConnectionId = '';
let appRef: INestApplication;
let poolRef: Pool;
let executionWorkerRef: WorkerFacade;
let userRef: Session;
let operationsRef: AdminOperationsService;
let circuitsRef: ProviderCircuitBreakerService;
// CI 的 Redis/MySQL 由 GitHub Actions 管理；仅本地 Compose 可安全执行停启故障注入。
const supportsRedisFaultInjection = process.env.CI !== 'true' && isContainerRunning('lazy-armor-p0-redis-1');
const supportsMysqlFaultInjection = process.env.CI !== 'true' && isContainerRunning('lazy-armor-p0-mysql-1');
const supportsCombinedFaultInjection = supportsRedisFaultInjection && supportsMysqlFaultInjection;
const redisFaultInjectionIt = supportsRedisFaultInjection ? it : it.skip;
const mysqlFaultInjectionIt = supportsMysqlFaultInjection ? it : it.skip;
const combinedFaultInjectionIt = supportsCombinedFaultInjection ? it : it.skip;

describe.sequential('P0-H4 outbox worker true-process reliability', { timeout: 240000 }, () => {
  let outbox: { claim(batch: number, workerId: string, leaseMs?: number): Promise<OutboxRow[]> };
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    if (!existsSync(outboxWorkerEntry)) {
      throw new Error('Outbox worker dist entrypoint is missing. Run `pnpm --filter @lazy-armor/api build` before the true-process outbox tests.');
    }
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.APP_ROLE = 'api';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 11).toString('base64');
    process.env.CREDENTIAL_STORE_PATH = `.data/test-h4-outbox-${unique}`;
    process.env.WORKER_READINESS_TIMEOUT_MS = '800';
    process.env.LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR = '1';
    process.env.LAZY_ARMOR_TRUE_PROCESS_CONNECTOR_STATE_PATH = harnessStatePath;
    resetHarnessState();

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    appRef = moduleRef.createNestApplication();
    appRef.setGlobalPrefix('api');
    appRef.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await appRef.init();

    poolRef = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 6, timezone: 'Z' });
    executionWorkerRef = appRef.get('EXECUTION_WORKER');
    outbox = appRef.get('OUTBOX_SERVICE');
    operationsRef = appRef.get(AdminOperationsService);
    circuitsRef = appRef.get(ProviderCircuitBreakerService);
    await circuitsRef.resetForTest('true_process_test');

    userRef = await register(appRef, `h4-outbox-${unique}@example.com`, 'H4 Outbox');
    sharedConnectionId = await createConnection(appRef, userRef.token, 'true_process_test', `True Process Connector-${unique}`);
    await grant(appRef, userRef.token, sharedConnectionId, 'TEST_OUTBOX_SAFE');
    await grant(appRef, userRef.token, sharedConnectionId, 'TEST_OUTBOX_UNSAFE');
  });

  afterEach(async () => {
    while (activeWorkers.length) {
      await stopWorker(activeWorkers.pop()!);
    }
    await ensurePermissionsGranted(appRef, userRef.token, sharedConnectionId);
    await ensureConnectionConnected();
    await circuitsRef.resetForTest('true_process_test');
    resetHarnessState();
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
    resetHarnessState();
    await poolRef?.end();
    await appRef?.close();
  });

  it('starts a standalone outbox worker, serves /live and /ready, and publishes pending outbox exactly once', async () => {
    const waiting = await prepareWaitingDispatch('outbox-startup', 'TEST_OUTBOX_SAFE', 'ok');
    const worker = await startOutboxWorker();

    const live = await fetchJson(`http://127.0.0.1:${worker.probePort}/live`);
    expect(live).toMatchObject({
      status: 'ok',
      role: 'outbox-worker',
    });
    expect(await waitForReady(worker.probePort, 200)).toMatchObject({
      status: 'ready',
      role: 'outbox-worker',
    });

    const operation = await waitForOperationStatus(waiting.stepId, 'succeeded');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'succeeded')).status).toBe('succeeded');
    expect((await outboxByOp(operation.id))?.status).toBe('published');
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(1);
  });

  redisFaultInjectionIt('keeps /live up, returns /ready=503 during Redis outage, and recovers after Redis restart', async () => {
    const worker = await startOutboxWorker();
    await waitForReady(worker.probePort, 200);

    stopContainer('lazy-armor-p0-redis-1');
    expect((await waitForLive(worker.probePort, 200)).status).toBe('ok');
    expect((await waitForReady(worker.probePort, 503)).status).toBe('not_ready');

    startContainer('lazy-armor-p0-redis-1');
    await ensureContainerHealthy('lazy-armor-p0-redis-1');
    expect((await waitForReady(worker.probePort, 200, 30_000)).status).toBe('ready');
  });

  mysqlFaultInjectionIt('keeps /live up, returns /ready=503 during MySQL outage, and recovers after MySQL restart', async () => {
    const worker = await startOutboxWorker();
    await waitForReady(worker.probePort, 200);

    stopContainer('lazy-armor-p0-mysql-1');
    expect((await waitForLive(worker.probePort, 200)).status).toBe('ok');
    expect((await waitForReady(worker.probePort, 503, 30_000)).status).toBe('not_ready');

    startContainer('lazy-armor-p0-mysql-1');
    await ensureContainerHealthy('lazy-armor-p0-mysql-1', 60_000);
    expect((await waitForReady(worker.probePort, 200, 60_000)).status).toBe('ready');
  });

  it('exits cleanly on SIGTERM and SIGINT and closes the probe server', async () => {
    const termWorker = await startOutboxWorker();
    await waitForReady(termWorker.probePort, 200);
    await stopWorker(termWorker, 'SIGTERM');
    expect(await isProbeReachable(termWorker.probePort)).toBe(false);

    const intWorker = await startOutboxWorker();
    await waitForReady(intWorker.probePort, 200);
    await stopWorker(intWorker, 'SIGINT');
    expect(await isProbeReachable(intWorker.probePort)).toBe(false);
  });

  it('blocks dispatch after runtime permission revoke and never calls the provider', async () => {
    const waiting = await prepareWaitingDispatch('permission-revoke', 'TEST_OUTBOX_SAFE', 'ok');
    await request(appRef.getHttpServer())
      .put(`/api/connections/${sharedConnectionId}/permissions`)
      .set(auth(userRef.token))
      .send({ permissions: [{ capability: 'TEST_OUTBOX_SAFE', granted: false }] })
      .expect(200);

    await startOutboxWorker();
    const operation = await waitForOperationStatus(waiting.stepId, 'failed');
    expect(operation.errorCode).toBe('PERMISSION_REVOKED');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'failed')).status).toBe('failed');
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(0);
    expect(receivedKeys('TEST_OUTBOX_SAFE')).toHaveLength(0);
  });

  it('reclaims an expired outbox lease with a new worker and still produces one real side effect', async () => {
    const waiting = await prepareWaitingDispatch('lease-recovery', 'TEST_OUTBOX_SAFE', 'ok');
    const operation = await waitForOperation(waiting.stepId);
    expect(operation).toBeTruthy();

    await outbox.claim(8, 'worker-crash', 30_000);
    await startOutboxWorker();
    await sleep(1_500);
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(0);

    await poolRef.query('UPDATE outbox_messages SET lock_expires_at=? WHERE aggregate_id=UUID_TO_BIN(?)', [new Date(Date.now() - 60_000), operation!.id]);

    expect((await waitForOperationStatus(waiting.stepId, 'succeeded')).status).toBe('succeeded');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'succeeded')).status).toBe('succeeded');
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(1);
  });

  it('retries a safe timeout with the same idempotency key and still applies only one side effect', async () => {
    const waiting = await prepareWaitingDispatch('timeout-retry', 'TEST_OUTBOX_SAFE', 'timeout-once');
    await startOutboxWorker();

    const operation = await waitForOperationStatus(waiting.stepId, 'succeeded');
    expect(operation.status).toBe('succeeded');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'succeeded')).status).toBe('succeeded');
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(1);
    expect(receivedKeys('TEST_OUTBOX_SAFE').length).toBeGreaterThanOrEqual(2);
    expect(new Set(receivedKeys('TEST_OUTBOX_SAFE')).size).toBe(1);
  });

  it('stops an unsafe timeout at outcome_unknown without blind retry', async () => {
    const waiting = await prepareWaitingDispatch('unsafe-timeout', 'TEST_OUTBOX_UNSAFE', 'timeout-always');
    await startOutboxWorker();

    const operation = await waitForOperationStatus(waiting.stepId, 'outcome_unknown');
    expect(operation.errorCode).toBe('TIMEOUT');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'failed')).status).toBe('failed');
    expect(sideEffects('TEST_OUTBOX_UNSAFE')).toBe(1);
    expect(receivedKeys('TEST_OUTBOX_UNSAFE')).toHaveLength(1);
  });

  it('retries a known retryable provider failure until dead_letter without switching to outcome_unknown', async () => {
    const waiting = await prepareWaitingDispatch('known-retryable-failure', 'TEST_OUTBOX_SAFE', 'provider-5xx-always');
    await startOutboxWorker();
    await accelerateOutboxRetries();

    const operation = await waitForOperationStatus(waiting.stepId, 'failed');
    const detail = await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'failed');
    const outboxRow = await outboxByOp(operation.id);

    expect(operation.errorCode).toBe('PROVIDER_5XX');
    expect(outboxRow).toMatchObject({
      status: 'dead',
      lastErrorCode: 'PROVIDER_5XX',
    });
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(0);
    expect(receivedKeys('TEST_OUTBOX_SAFE').length).toBeGreaterThanOrEqual(5);
    expect(new Set(receivedKeys('TEST_OUTBOX_SAFE')).size).toBe(1);
    expect(detail.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'side_effect_dead_letter',
        actionRequired: true,
      }),
    ]));
    expect(detail.notifications.some((notice: { eventType: string }) => notice.eventType === 'side_effect_outcome_unknown')).toBe(false);
    expect(detail.events.some((event: { eventType: string }) => event.eventType === 'side_effect_dead_letter')).toBe(true);
  });

  it('fails a non-retryable provider rejection once and never upgrades it to outcome_unknown', async () => {
    const waiting = await prepareWaitingDispatch('known-rejection', 'TEST_OUTBOX_SAFE', 'reject');
    await startOutboxWorker();

    const operation = await waitForOperationStatus(waiting.stepId, 'failed');
    const detail = await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'failed');
    const outboxRow = await outboxByOp(operation.id);

    expect(operation.errorCode).toBe('PROVIDER_REJECTED');
    expect(outboxRow).toMatchObject({
      status: 'dead',
      lastErrorCode: 'PROVIDER_REJECTED',
    });
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(0);
    expect(receivedKeys('TEST_OUTBOX_SAFE')).toHaveLength(1);
    expect(detail.notifications.some((notice: { eventType: string }) => notice.eventType === 'side_effect_outcome_unknown')).toBe(false);
    expect(detail.events.some((event: { eventType: string }) => event.eventType === 'side_effect_failed')).toBe(true);
  });

  combinedFaultInjectionIt('never re-dispatches a dead_letter after worker or dependency restarts', async () => {
    const waiting = await prepareWaitingDispatch('dead-letter-boundary', 'TEST_OUTBOX_SAFE', 'provider-5xx-always');
    await startOutboxWorker();
    await accelerateOutboxRetries();

    const operation = await waitForOperationStatus(waiting.stepId, 'failed');
    expect((await outboxByOp(operation.id))?.status).toBe('dead');
    const callsBeforeRestart = receivedKeys('TEST_OUTBOX_SAFE').length;

    await startOutboxWorker();
    await sleep(2_000);
    expect(receivedKeys('TEST_OUTBOX_SAFE').length).toBe(callsBeforeRestart);

    stopContainer('lazy-armor-p0-redis-1');
    startContainer('lazy-armor-p0-redis-1');
    await ensureContainerHealthy('lazy-armor-p0-redis-1');
    stopContainer('lazy-armor-p0-mysql-1');
    startContainer('lazy-armor-p0-mysql-1');
    await ensureContainerHealthy('lazy-armor-p0-mysql-1', 60_000);

    await startOutboxWorker();
    await sleep(2_000);
    expect(receivedKeys('TEST_OUTBOX_SAFE').length).toBe(callsBeforeRestart);
    expect((await outboxByOp(operation.id))?.status).toBe('dead');
  });

  it('recovers after provider success followed by worker crash without repeating the side effect', async () => {
    const waiting = await prepareWaitingDispatch('success-then-crash', 'TEST_OUTBOX_SAFE', 'crash-after-success-once');
    const firstWorker = await startOutboxWorker();
    expect(await waitForExit(firstWorker.child, 20_000)).toBe(true);
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(1);

    const operation = await waitForOperation(waiting.stepId);
    expect(operation).toBeTruthy();
    await poolRef.query('UPDATE outbox_messages SET lock_expires_at=? WHERE aggregate_id=UUID_TO_BIN(?)', [new Date(Date.now() - 60_000), operation!.id]);

    await startOutboxWorker();
    expect((await waitForOperationStatus(waiting.stepId, 'succeeded')).status).toBe('succeeded');
    expect((await waitForExecutionStatus(appRef, userRef.token, waiting.executionId, 'succeeded')).status).toBe('succeeded');
    expect(sideEffects('TEST_OUTBOX_SAFE')).toBe(1);
    expect(receivedKeys('TEST_OUTBOX_SAFE').length).toBeGreaterThanOrEqual(2);
    expect(new Set(receivedKeys('TEST_OUTBOX_SAFE')).size).toBe(1);
  });

  it('updates operations metrics from real outbox backlog, active work, dead letter, and outcome_unknown states', async () => {
    const pending = await prepareWaitingDispatch('ops-backlog', 'TEST_OUTBOX_SAFE', 'ok');
    const pendingOperation = await waitForOperation(pending.stepId);
    expect(pendingOperation).toBeTruthy();

    const backlog = await waitForOutboxMetrics((metrics) =>
      metrics.workers.outboxWorker.queueBacklog > 0
      && metrics.workers.outboxWorker.oldestPendingAgeSeconds !== null,
    );
    expect(backlog.workers.outboxWorker.queueBacklog).toBeGreaterThan(0);

    const claimed = await outbox.claim(1, 'ops-active', 30_000);
    expect(claimed).toHaveLength(1);
    const active = await waitForOutboxMetrics((metrics) => metrics.workers.outboxWorker.activeWork > 0);
    expect(active.workers.outboxWorker.activeWork).toBeGreaterThan(0);

    await poolRef.query(
      'UPDATE outbox_messages SET status=\'pending\', locked_by=NULL, lock_expires_at=NULL, next_attempt_at=? WHERE id=UUID_TO_BIN(?)',
      [new Date(Date.now() - 1_000), claimed[0].id],
    );
    await startOutboxWorker();
    await waitForOperationStatus(pending.stepId, 'succeeded');

    const dead = await prepareWaitingDispatch('ops-dead-letter', 'TEST_OUTBOX_SAFE', 'provider-5xx-always');
    await accelerateOutboxRetries();
    await waitForOperationStatus(dead.stepId, 'failed');
    const deadMetrics = await waitForOutboxMetrics((metrics) =>
      metrics.outbox.deadCount > 0
      && metrics.overview.delivery.deadOutbox > 0
      && metrics.workers.outboxWorker.recentFailures.some((item: { errorCode: string | null }) => item.errorCode === 'PROVIDER_5XX'),
    );
    expect(deadMetrics.outbox.recentFailures.some((item: { lastErrorCode: string | null }) => item.lastErrorCode === 'PROVIDER_5XX')).toBe(true);

    await circuitsRef.resetForTest('true_process_test');
    const unknown = await prepareWaitingDispatch('ops-outcome-unknown', 'TEST_OUTBOX_UNSAFE', 'timeout-always');
    await waitForOperationStatus(unknown.stepId, 'outcome_unknown');
    const unknownMetrics = await waitForOutboxMetrics((metrics) => metrics.overview.delivery.outcomeUnknown > 0);
    expect(unknownMetrics.overview.delivery.outcomeUnknown).toBeGreaterThan(0);
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

async function grant(app: INestApplication, token: string, connectionId: string, capability: string) {
  await request(app.getHttpServer())
    .put(`/api/connections/${connectionId}/permissions`)
    .set(auth(token))
    .send({ permissions: [{ capability, granted: true }] })
    .expect(200);
}

async function ensurePermissionsGranted(app: INestApplication, token: string, connectionId: string) {
  await request(app.getHttpServer())
    .put(`/api/connections/${connectionId}/permissions`)
    .set(auth(token))
    .send({
      permissions: [
        { capability: 'TEST_OUTBOX_SAFE', granted: true },
        { capability: 'TEST_OUTBOX_UNSAFE', granted: true },
      ],
    })
    .expect(200);
}

async function ensureConnectionConnected() {
  if (!sharedConnectionId) return;
  await poolQuery('UPDATE connections SET status=\'connected\', credential_ref_id=NULL WHERE id=UUID_TO_BIN(?)', [sharedConnectionId]);
}

async function createSideEffectPlan(app: INestApplication, token: string, name: string, capability: 'TEST_OUTBOX_SAFE' | 'TEST_OUTBOX_UNSAFE', behavior: string) {
  void behavior;
  const created = await request(app.getHttpServer())
    .post('/api/plans')
    .set(auth(token))
    .send({
      name,
      description: 'P0-H4 true outbox worker process',
      domain: 'general',
      automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
      conditions: [],
      actions: [{
        actionType: 'update_internal_record',
        connectionId: sharedConnectionId,
        requiredCapability: capability,
        config: { recordType: 'outbox-h4' },
        stepOrder: 0,
      }],
    })
    .expect(201);
  await activatePlan(app, token, created.body.id as string);
  return created.body.id as string;
}

async function activatePlan(app: INestApplication, token: string, planId: string) {
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
}

async function dispatch(app: INestApplication, token: string, planId: string, requestId: string, behavior: string) {
  const created = await request(app.getHttpServer())
    .post(`/api/plans/${planId}/executions`)
    .set(auth(token))
    .send({ requestId, triggerPayload: { amount: 300, behavior } })
    .expect(201);
  return created.body.id as string;
}

async function detail(app: INestApplication, token: string, executionId: string) {
  return (await request(app.getHttpServer()).get(`/api/executions/${executionId}`).set(auth(token)).expect(200)).body;
}

async function prepareWaitingDispatch(name: string, capability: 'TEST_OUTBOX_SAFE' | 'TEST_OUTBOX_UNSAFE', behavior: string) {
  const planId = await createSideEffectPlan(appRef, userRef.token, `${name}-${Date.now()}`, capability, behavior);
  const executionId = await dispatch(appRef, userRef.token, planId, `${name}-${Date.now()}`, behavior);
  expect((await executionWorkerRef.processExecution(executionId)).status).toBe('waiting_approval');
  const execution = await detail(appRef, userRef.token, executionId);
  const approvals = (await request(appRef.getHttpServer()).get('/api/approvals?status=pending').set(auth(userRef.token)).expect(200)).body as ApprovalRow[];
  const approval = approvals.find((item) => item.executionId === executionId);
  expect(approval).toBeTruthy();
  await request(appRef.getHttpServer())
    .post(`/api/approvals/${approval!.id}/approve`)
    .set(auth(userRef.token))
    .send({ deviceId: 'p0-h4-outbox-test' })
    .expect(201);
  expect((await executionWorkerRef.processExecution(executionId)).status).toBe('waiting_dispatch');
  return { executionId, stepId: execution.steps[0].id as string, approvalId: approval!.id };
}

async function waitForExecutionStatus(app: INestApplication, token: string, executionId: string, status: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await detail(app, token, executionId);
    if (row.status === status) return row;
    await sleep(250);
  }
  throw new Error(`Execution did not reach ${status}`);
}

async function waitForOperation(stepId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await operationByStep(stepId);
    if (row) return row;
    await sleep(200);
  }
  return null;
}

async function waitForOperationStatus(stepId: string, status: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await operationByStep(stepId);
    if (row?.status === status) return row;
    await sleep(250);
  }
  const current = await operationByStep(stepId);
  const outboxRow = current ? await outboxByOp(current.id) : null;
  throw new Error(`Operation did not reach ${status}; current=${current?.status ?? 'missing'} error=${current?.errorCode ?? 'null'} outbox=${outboxRow?.status ?? 'missing'} attempts=${outboxRow?.attemptCount ?? 'null'} lastError=${outboxRow?.lastErrorCode ?? 'null'}`);
}

async function accelerateOutboxRetries(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await poolRef.query('UPDATE outbox_messages SET next_attempt_at=? WHERE status=\'retry_wait\'', [new Date(Date.now() - 1_000)]);
    await sleep(350);
  }
}

async function waitForOutboxMetrics(
  predicate: (metrics: {
    workers: Awaited<ReturnType<AdminOperationsService['workers']>>;
    overview: Awaited<ReturnType<AdminOperationsService['overview']>>;
    outbox: Awaited<ReturnType<AdminOperationsService['outbox']>>;
  }) => boolean,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [workers, overview, outboxStatus] = await Promise.all([
      operationsRef.workers(),
      operationsRef.overview(),
      operationsRef.outbox(),
    ]);
    const metrics = { workers, overview, outbox: outboxStatus };
    if (predicate(metrics)) return metrics;
    await sleep(250);
  }
  throw new Error('Operations outbox metrics did not reach expected state');
}

async function operationByStep(stepId: string): Promise<OperationRow | null> {
  const [rows] = await poolRef.query<RowDataPacket[]>(
    'SELECT BIN_TO_UUID(id) id, status, idempotency_key idempotencyKey, error_code errorCode FROM side_effect_operations WHERE execution_step_id=UUID_TO_BIN(?)',
    [stepId],
  );
  return (rows[0] as unknown as OperationRow) ?? null;
}

async function outboxByOp(opId: string): Promise<OutboxRow | null> {
  const [rows] = await poolRef.query<RowDataPacket[]>(
    'SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(aggregate_id) aggregateId, status, attempt_count attemptCount, dedupe_key dedupeKey, last_error_code lastErrorCode FROM outbox_messages WHERE aggregate_id=UUID_TO_BIN(?)',
    [opId],
  );
  return (rows[0] as unknown as OutboxRow) ?? null;
}

async function startOutboxWorker(): Promise<WorkerProcess> {
  const probePort = nextPort();
  const output: string[] = [];
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'development',
    APP_ROLE: 'outbox-worker',
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY!,
    CREDENTIAL_STORE_PATH: process.env.CREDENTIAL_STORE_PATH!,
    WORKER_READINESS_TIMEOUT_MS: process.env.WORKER_READINESS_TIMEOUT_MS ?? '800',
    LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    LAZY_ARMOR_TRUE_PROCESS_CONNECTOR_STATE_PATH: harnessStatePath,
    WORKER_PROBE_HOST: '127.0.0.1',
    OUTBOX_WORKER_PROBE_PORT: String(probePort),
  };
  const child = spawn(process.execPath, [outboxWorkerEntry], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));
  const worker = { child, role: 'outbox-worker' as const, probePort, output };
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

function resetHarnessState() {
  rmSync(harnessStatePath, { force: true });
}

function readHarnessState(): HarnessState {
  if (!existsSync(harnessStatePath)) {
    return { appliedKeys: [], sideEffects: {}, receivedKeys: {}, callCounts: {} };
  }
  return JSON.parse(readFileSync(harnessStatePath, 'utf8')) as HarnessState;
}

function sideEffects(capability: string) {
  return readHarnessState().sideEffects[capability] ?? 0;
}

function receivedKeys(capability: string) {
  return readHarnessState().receivedKeys[capability] ?? [];
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

async function poolQuery(sql: string, params: unknown[]) {
  await poolRef.query(sql, params);
}
