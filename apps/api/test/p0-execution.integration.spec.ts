import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Connector, ConnectorRequest, ConnectorResult } from '@lazy-armor/connector-sdk';
import { createPool, type Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionRuntimeError } from '../dist/execution/execution.types.js';

interface Session { token: string; userId: string }
interface WorkerFacade { processExecution(id: string): Promise<{ status: string; retryScheduled?: boolean }> }
interface QueueFacade { failNextEnqueueForTest(): void; hasExecutionJob(id: string): Promise<boolean>; removeExecutionJob(id: string): Promise<void> }
interface ReconcilerFacade { reconcile(staleBefore?: Date): Promise<{ scanned: number; recovered: number }> }

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class RuntimeTestConnector implements Connector {
  readonly calls = new Map<string, number>();
  constructor(private readonly key: string) {}
  metadata = () => ({ key: this.key, name: 'P0-5 Test Connector', description: 'Only registered inside integration tests', version: '1.0.0-test', connectorSdkVersion: '0.1.0', providerType: 'internal' as const, productionStatus: 'DRAFT_ONLY' as const, authentication: { type: 'none' as const }, supportsRefresh: false, supportsRevoke: false, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'full' as const, rateLimitStrategy: 'unknown' as const });
  capabilities = () => [{ key: 'TEST_EXECUTE', name: 'Test execute', riskLevel: 'R1' as const, operation: 'execute' as const, requiredPermission: 'TEST_EXECUTE', providerAvailability: 'available' as const }];
  async validateConnection() { return { status: 'healthy' as const, checkedAt: new Date().toISOString() }; }
  async execute(request: ConnectorRequest): Promise<ConnectorResult> {
    const context = request.input.context as Record<string, unknown>;
    const behavior = context.behavior;
    const calls = (this.calls.get(request.requestId) ?? 0) + 1;
    this.calls.set(request.requestId, calls);
    if (behavior === 'timeout_once' && calls === 1) throw new ExecutionRuntimeError('TIMEOUT', 'temporary network failure', true);
    if (behavior === 'always_temporary') return { ok: false, data: {} };
    if (behavior === 'slow') await wait(80);
    if (behavior === 'longer_than_test_lease') await wait(1_300);
    if (behavior === 'secret_output') return { ok: true, data: { token: 'output-token-must-not-leak', nested: { credential: 'credential-must-not-leak' } } };
    if (behavior === 'secret_error') throw new Error('upstream failed token=raw-secret authorization=Bearer-secret');
    return { ok: true, data: { testExecuted: true, calls } };
  }
}

describe.sequential('P0-5 Execution Engine integration and security', () => {
  let app: INestApplication;
  let pool: Pool;
  let userA: Session;
  let userB: Session;
  let worker: WorkerFacade;
  let queue: QueueFacade;
  let reconciler: ReconcilerFacade;
  let executionStates: { transition(id: string, status: string): Promise<void> };
  let policy: { retry: Record<string, unknown>; delayForRetry(count: number, value?: Record<string, unknown>): number };
  let fallback: { execute(userId: string, planId: string, executionId: string, stepId: string, errorCode: string, policy: unknown): Promise<Record<string, unknown>> };
  let testConnector: RuntimeTestConnector;
  let testConnectorKey: string;
  let testConnectionId: string;
  let internalConnectionId: string;
  let canonicalPlanId: string;
  let canonicalV1Id: string;
  let canonicalV1Hash: string;
  let canonicalExecutionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-execution-credentials-${unique}`;
    const { AppModule } = await import('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });
    worker = app.get('EXECUTION_WORKER');
    queue = app.get('EXECUTION_QUEUE_SERVICE');
    reconciler = app.get('EXECUTION_RECONCILER');
    executionStates = app.get('EXECUTION_STATE_SERVICE');
    policy = app.get('EXECUTION_POLICY_SERVICE');
    fallback = app.get('FALLBACK_EXECUTOR');
    const registry = app.get<{ register(connector: Connector): void }>('CONNECTOR_REGISTRY');
    testConnectorKey = `test-${unique}`.slice(0, 80);
    testConnector = new RuntimeTestConnector(testConnectorKey);
    registry.register(testConnector);
    const connectorId = randomUUID(); const capabilityId = randomUUID();
    await pool.query("INSERT INTO connectors (id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES (UUID_TO_BIN(?),?,'P0-5 Test Connector','active','1.0.0-test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, testConnectorKey]);
    await pool.query("INSERT INTO connector_capabilities (id,connector_id,capability_key,name,operation,risk_level,created_at) VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),'TEST_EXECUTE','Test execute','execute','R1',UTC_TIMESTAMP(6))", [capabilityId, connectorId]);
    userA = await register(`execution-a-${unique}@example.com`, '执行用户 A');
    userB = await register(`execution-b-${unique}@example.com`, '执行用户 B');
    testConnectionId = await createConnection(userA.token, testConnectorKey, '测试连接');
    await grant(userA.token, testConnectionId, 'TEST_EXECUTE');
    internalConnectionId = await createConnection(userA.token, 'internal', '内部安全连接');
    await grant(userA.token, internalConnectionId, 'WRITE_INTERNAL');
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(response.body.accessToken)).expect(200);
    return { token: response.body.accessToken, userId: me.body.id };
  }
  async function createConnection(token: string, connectorId: string, name: string, expiresAt?: string) {
    const response = await request(app.getHttpServer()).post('/api/connections').set(auth(token)).send({ connectorId, externalAccountName: name, expiresAt }).expect(201);
    return response.body.id as string;
  }
  async function grant(token: string, id: string, capability: string, expiresAt?: string) {
    return request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(token)).send({ permissions: [{ capability, granted: true, expiresAt }] }).expect(200);
  }
  const record = (stepOrder = 0) => ({ actionType: 'record', config: { recordType: 'demo' }, stepOrder });
  const compare = (stepOrder = 0) => ({ actionType: 'compare', config: {}, stepOrder });
  const testAction = (connectionId = testConnectionId, stepOrder = 0) => ({ actionType: 'update_internal_record', connectionId, requiredCapability: 'TEST_EXECUTE', config: { recordType: 'test' }, stepOrder });
  const definition = (name: string, actions: Array<Record<string, unknown>> = [record()], threshold = 200) => ({
    name, description: 'P0-5 execution test', domain: 'general', automationLevel: 'L1',
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
    conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: threshold, sortOrder: 0 }], actions,
  });
  async function createPlan(token: string, body: Record<string, unknown>, activate = true) {
    const created = await request(app.getHttpServer()).post('/api/plans').set(auth(token)).send(body).expect(201);
    if (!activate) return created.body;
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/versions/1/apply`).set(auth(token)).expect(201);
    return (await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(token)).send({ status: 'active' }).expect(201)).body;
  }
  function dispatch(token: string, planId: string, payload: Record<string, unknown>, requestId = `exec-${unique}-${randomUUID()}`) {
    return request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(token)).send({ requestId, triggerPayload: payload });
  }
  async function detail(token: string, executionId: string) { return (await request(app.getHttpServer()).get(`/api/executions/${executionId}`).set(auth(token)).expect(200)).body; }
  async function waitForStatus(token: string, executionId: string, status: string) {
    for (let index = 0; index < 30; index += 1) { const row = await detail(token, executionId); if (row.status === status) return row; await wait(10); }
    throw new Error(`Execution did not reach ${status}`);
  }
  async function waitForConnectorCall(requestId: string) {
    for (let index = 0; index < 30; index += 1) { if ((testConnector.calls.get(requestId) ?? 0) > 0) return; await wait(10); }
    throw new Error(`Connector call did not start: ${requestId}`);
  }

  it('1-7 creates an Execution and all ordered Steps transactionally from the active version', async () => {
    const plan = await createPlan(userA.token, definition('金额记录测试', [compare(0), record(1)]));
    canonicalPlanId = plan.id; canonicalV1Id = plan.activeVersionId; canonicalV1Hash = plan.activeVersion.definitionHash;
    const created = await dispatch(userA.token, plan.id, { amount: 268, password: 'must-not-persist' });
    expect(created.status).toBe(201); canonicalExecutionId = created.body.id;
    const result = await detail(userA.token, created.body.id);
    expect(result).toMatchObject({ status: 'queued', planVersionId: canonicalV1Id, definitionHash: canonicalV1Hash, planVersionNumber: 1 });
    expect(result.steps.map((step: { stepOrder: number }) => step.stepOrder)).toEqual([0, 1]);
    expect(result.resolvedRetryPolicyJson).toBeUndefined();
  });

  it('8 rolls back Execution and Steps when step creation fails', async () => {
    const before = (await request(app.getHttpServer()).get('/api/executions').set(auth(userA.token)).expect(200)).body.length;
    await pool.query("CREATE TRIGGER p0_5_test_step_insert_failure BEFORE INSERT ON execution_steps FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='simulated step insert failure'");
    try { await dispatch(userA.token, canonicalPlanId, { amount: 300 }, `rollback-${unique}`).expect(500); }
    finally { await pool.query('DROP TRIGGER p0_5_test_step_insert_failure'); }
    const after = (await request(app.getHttpServer()).get('/api/executions').set(auth(userA.token)).expect(200)).body.length;
    expect(after).toBe(before);
  });

  it('9-11 consumes the manual Job and succeeds with Steps in stable order', async () => {
    const outcome = await worker.processExecution(canonicalExecutionId);
    expect(outcome.status).toBe('succeeded');
    const result = await detail(userA.token, canonicalExecutionId);
    expect(result.steps.map((step: { status: string }) => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(result.resultCode).toBe('EXECUTION_COMPLETED');
  });

  it('12 rejects non-active Plans and active Plans without active_version', async () => {
    const draft = await createPlan(userA.token, definition('草稿不可运行'), false);
    await dispatch(userA.token, draft.id, { amount: 300 }).expect(409);
    await pool.query("UPDATE plans SET status='active' WHERE id=UUID_TO_BIN(?)", [draft.id]);
    await dispatch(userA.token, draft.id, { amount: 300 }).expect(409);
  });

  it('13 rejects cross-user dispatch without trusting a client user id', async () => {
    await dispatch(userB.token, canonicalPlanId, { amount: 300, userId: userA.userId }).expect(404);
  });

  it('14 treats false Conditions as succeeded no-op and skips all snapshotted Steps', async () => {
    const created = await dispatch(userA.token, canonicalPlanId, { amount: 100 }).expect(201);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const result = await detail(userA.token, created.body.id);
    expect(result.resultCode).toBe('CONDITIONS_NOT_MET');
    expect(result.steps.every((step: { status: string }) => step.status === 'skipped')).toBe(true);
  });

  it('15 fails invalid Condition input rather than treating it as false', async () => {
    const created = await dispatch(userA.token, canonicalPlanId, { amount: 'abc' }).expect(201);
    await worker.processExecution(created.body.id);
    expect(await detail(userA.token, created.body.id)).toMatchObject({ status: 'failed', errorCode: 'CONDITION_INPUT_INVALID' });
  });

  it('16 keeps R2 internal actions running and routes only R3/R4 into the P0-6 approval gate', async () => {
    const r2Plan = await createPlan(userA.token, definition('R2 内部动作', [{
      actionType: 'generate_content',
      config: { format: 'short', targetPlatforms: ['douyin'] },
      stepOrder: 0,
    }]));
    const r2Created = await dispatch(userA.token, r2Plan.id, {
      amount: 300,
      masterContent: {
        title: '周末把衣柜整理好',
        body: '顺手整理换季衣物，并准备一条适合短视频平台的文案。',
        tags: ['收纳', '换季'],
        coverReference: 'cover://demo',
      },
      targetPlatforms: ['douyin'],
    }).expect(201);
    await worker.processExecution(r2Created.body.id);
    expect((await detail(userA.token, r2Created.body.id)).status).toBe('succeeded');

    const definitions = [
      definition('R3 安全门', [{ actionType: 'publish', connectionId: internalConnectionId, config: { visibility: 'private' }, stepOrder: 0 }]),
      definition('R4 安全门', [{ actionType: 'create_order', connectionId: internalConnectionId, config: { currency: 'CNY' }, stepOrder: 0 }]),
    ];
    for (const body of definitions) {
      const plan = await createPlan(userA.token, body);
      const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
      await worker.processExecution(created.body.id);
      const waiting = await detail(userA.token, created.body.id);
      expect(waiting.status).toBe('waiting_approval');
      expect(waiting.steps[0].approvalGateStatus).toBe('waiting_approval');
    }
  });

  it('17 creates partially_succeeded when an earlier Step succeeded and a later Step failed', async () => {
    const connectionId = await createConnection(userA.token, testConnectorKey, '部分成功未授权');
    const plan = await createPlan(userA.token, definition('部分成功', [record(0), testAction(connectionId, 1)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    expect((await worker.processExecution(created.body.id)).status).toBe('partially_succeeded');
  });

  it('18 makes a fully failed Execution terminal and never executes a later Step', async () => {
    const connectionId = await createConnection(userA.token, testConnectorKey, '全部失败未授权');
    const plan = await createPlan(userA.token, definition('全部失败', [testAction(connectionId, 0), record(1)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    await worker.processExecution(created.body.id);
    const result = await detail(userA.token, created.body.id);
    expect(result.status).toBe('failed');
    expect(result.steps.map((step: { status: string }) => step.status)).toEqual(['failed', 'pending']);
    const attempts = result.steps[0].attemptCount;
    await worker.processExecution(created.body.id);
    expect((await detail(userA.token, created.body.id)).steps[0].attemptCount).toBe(attempts);
  });

  it('19 retries only the failed Step and does not repeat succeeded Steps', async () => {
    const plan = await createPlan(userA.token, definition('超时后恢复', [record(0), testAction(testConnectionId, 1)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'timeout_once' }).expect(201);
    expect(await worker.processExecution(created.body.id)).toMatchObject({ status: 'retry_wait', retryScheduled: true });
    await wait(30);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const result = await detail(userA.token, created.body.id);
    expect(result.steps[0]).toMatchObject({ status: 'succeeded', attemptCount: 1 });
    expect(result.steps[1]).toMatchObject({ status: 'succeeded', attemptCount: 2, retryCount: 1 });
    expect(result.events.some((event: { eventType: string }) => event.eventType === 'retry_scheduled')).toBe(true);
  });

  it('20 enforces max_attempts then executes bounded Fallback', async () => {
    const plan = await createPlan(userA.token, definition('持续临时失败', [testAction()]));
    const created = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'always_temporary' }).expect(201);
    await worker.processExecution(created.body.id); await wait(30);
    await worker.processExecution(created.body.id); await wait(55);
    expect((await worker.processExecution(created.body.id)).status).toBe('failed');
    const result = await detail(userA.token, created.body.id);
    expect(result.steps[0]).toMatchObject({ attemptCount: 3, retryCount: 2 });
    expect(result.events.filter((event: { eventType: string }) => event.eventType === 'fallback_executed')).toHaveLength(1);
  });

  it('21 supports fixed/exponential backoff with max_delay', () => {
    expect(policy.delayForRetry(3, { ...policy.retry, backoffStrategy: 'fixed', initialDelayMs: 10, maxDelayMs: 15 })).toBe(10);
    expect(policy.delayForRetry(3, { ...policy.retry, backoffStrategy: 'exponential', initialDelayMs: 10, maxDelayMs: 100 })).toBe(40);
    expect(policy.delayForRetry(6, { ...policy.retry, backoffStrategy: 'exponential', initialDelayMs: 10, maxDelayMs: 50 })).toBe(50);
  });

  it('22 supports controlled Fallback outcomes without Notification', async () => {
    const queued = await dispatch(userA.token, canonicalPlanId, { amount: 300 }).expect(201);
    const row = await detail(userA.token, queued.body.id); const stepId = row.steps[0].id;
    expect(await fallback.execute(userA.userId, canonicalPlanId, queued.body.id, stepId, 'INVALID_INPUT', { strategy: 'skip_step' })).toMatchObject({ continueExecution: true, stepStatus: 'skipped' });
    expect(await fallback.execute(userA.userId, canonicalPlanId, queued.body.id, stepId, 'INVALID_INPUT', { strategy: 'require_manual_intervention' })).toMatchObject({ manualInterventionRequired: true });
    expect(await fallback.execute(userA.userId, canonicalPlanId, queued.body.id, stepId, 'INVALID_INPUT', { strategy: 'fail_execution' })).toMatchObject({ continueExecution: false });
    await request(app.getHttpServer()).post(`/api/executions/${queued.body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('23 pause_plan Fallback uses the Plan Domain Service', async () => {
    const plan = await createPlan(userA.token, definition('暂停 Fallback'));
    const queued = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    const row = await detail(userA.token, queued.body.id);
    expect(await fallback.execute(userA.userId, plan.id, queued.body.id, row.steps[0].id, 'INVALID_INPUT', { strategy: 'pause_plan' })).toMatchObject({ resultCode: 'FALLBACK_PLAN_PAUSED' });
    expect((await request(app.getHttpServer()).get(`/api/plans/${plan.id}`).set(auth(userA.token)).expect(200)).body.status).toBe('paused');
  });

  it('24 executes a Connector Step only with a currently valid Connection and Permission', async () => {
    const plan = await createPlan(userA.token, definition('连接器成功', [testAction()]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
  });

  it('25 blocks a revoked Connection at runtime and blocks the Plan', async () => {
    const connectionId = await createConnection(userA.token, testConnectorKey, '撤销竞态'); await grant(userA.token, connectionId, 'TEST_EXECUTE');
    const plan = await createPlan(userA.token, definition('连接撤销', [testAction(connectionId)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(userA.token)).expect(204);
    await worker.processExecution(created.body.id);
    expect(await detail(userA.token, created.body.id)).toMatchObject({ status: 'failed', errorCode: 'CONNECTION_REVOKED' });
    expect((await request(app.getHttpServer()).get(`/api/plans/${plan.id}`).set(auth(userA.token)).expect(200)).body.status).toBe('blocked');
  });

  it('26 blocks an expired Connection at runtime', async () => {
    const connectionId = await createConnection(userA.token, testConnectorKey, '过期竞态', new Date(Date.now() + 500).toISOString()); await grant(userA.token, connectionId, 'TEST_EXECUTE');
    const plan = await createPlan(userA.token, definition('连接过期', [testAction(connectionId)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201); await wait(700);
    await worker.processExecution(created.body.id);
    expect((await detail(userA.token, created.body.id)).errorCode).toBe('CONNECTION_EXPIRED');
  });

  it('27 blocks revoked, expired and absent Permission at runtime without Retry', async () => {
    for (const mode of ['revoked', 'expired', 'missing'] as const) {
      const connectionId = await createConnection(userA.token, testConnectorKey, `权限-${mode}`);
      if (mode !== 'missing') await grant(userA.token, connectionId, 'TEST_EXECUTE', mode === 'expired' ? '2020-01-01T00:00:00.000Z' : undefined);
      const plan = await createPlan(userA.token, definition(`权限 ${mode}`, [testAction(connectionId)]));
      const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
      if (mode === 'revoked') await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_EXECUTE', granted: false }] }).expect(200);
      await worker.processExecution(created.body.id);
      const result = await detail(userA.token, created.body.id);
      expect(result.status).toBe('failed'); expect(result.steps[0].attemptCount).toBe(1);
      expect(result.errorCode).toBe(mode === 'revoked' ? 'PERMISSION_REVOKED' : mode === 'expired' ? 'PERMISSION_EXPIRED' : 'CAPABILITY_NOT_GRANTED');
    }
  });

  it('28 allows only one of two competing Workers to acquire the lease', async () => {
    const plan = await createPlan(userA.token, definition('并发 Lease', [testAction()]));
    const created = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'slow' }).expect(201);
    const beforeCalls = [...testConnector.calls.values()].reduce((a, b) => a + b, 0);
    await Promise.all([worker.processExecution(created.body.id), worker.processExecution(created.body.id)]);
    const afterCalls = [...testConnector.calls.values()].reduce((a, b) => a + b, 0);
    expect(afterCalls - beforeCalls).toBe(1);
    expect((await detail(userA.token, created.body.id)).status).toBe('succeeded');

    const heartbeatPlan = await createPlan(userA.token, definition('持续心跳', [testAction()]));
    const longRunning = await dispatch(userA.token, heartbeatPlan.id, { amount: 300, behavior: 'longer_than_test_lease' }).expect(201);
    const firstWorker = worker.processExecution(longRunning.body.id);
    await waitForConnectorCall(`${longRunning.body.id}:0`);
    await wait(1_100);
    expect((await worker.processExecution(longRunning.body.id)).status).toBe('running');
    expect((await firstWorker).status).toBe('succeeded');
    expect(testConnector.calls.get(`${longRunning.body.id}:0`)).toBe(1);
  });

  it('29 recovers an expired Worker lease and resumes without repeating succeeded Steps', async () => {
    const plan = await createPlan(userA.token, definition('崩溃续跑', [compare(0), testAction(testConnectionId, 1)]));
    const created = await dispatch(userA.token, plan.id, { amount: 300 }).expect(201);
    const row = await detail(userA.token, created.body.id);
    await queue.removeExecutionJob(created.body.id);
    await pool.query("UPDATE executions SET status='running',worker_token='dead-worker',heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 SECOND),started_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [created.body.id]);
    await pool.query("UPDATE execution_steps SET status='succeeded',attempt_count=1,started_at=UTC_TIMESTAMP(6),finished_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [row.steps[0].id]);
    await pool.query("UPDATE execution_steps SET status='running',attempt_count=1,started_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [row.steps[1].id]);
    expect((await reconciler.reconcile(new Date(Date.now() + 1_000))).recovered).toBeGreaterThanOrEqual(1);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const recovered = await detail(userA.token, created.body.id);
    expect(recovered.steps[0].attemptCount).toBe(1);
    expect(recovered.steps[1].attemptCount).toBe(2);
    expect(recovered.events.some((event: { eventType: string }) => event.eventType === 'worker_lease_recovered')).toBe(true);
  });

  it('30 reconciles a DB-created Execution after Queue failure without creating another Execution', async () => {
    queue.failNextEnqueueForTest();
    const created = await dispatch(userA.token, canonicalPlanId, { amount: 300 }, `recovery-${unique}`).expect(201);
    expect(created.body.status).toBe('created'); expect(await queue.hasExecutionJob(created.body.id)).toBe(false);
    expect((await reconciler.reconcile(new Date(Date.now() + 1_000))).recovered).toBe(1);
    expect((await reconciler.reconcile(new Date(Date.now() + 1_000))).recovered).toBe(0);
    const all = (await request(app.getHttpServer()).get('/api/executions').set(auth(userA.token)).expect(200)).body;
    expect(all.filter((item: { requestId?: string; id: string }) => item.id === created.body.id)).toHaveLength(1);
    await request(app.getHttpServer()).post(`/api/executions/${created.body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('31 deduplicates repeated request_id and stable Queue Job identity', async () => {
    const requestId = `dedupe-${unique}`;
    const first = await dispatch(userA.token, canonicalPlanId, { amount: 300 }, requestId).expect(201);
    const second = await dispatch(userA.token, canonicalPlanId, { amount: 999 }, requestId).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await queue.hasExecutionJob(first.body.id)).toBe(true);
    await request(app.getHttpServer()).post(`/api/executions/${first.body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('32 supports queued and cooperative running cancellation without pretending to interrupt a Connector', async () => {
    const queued = await dispatch(userA.token, canonicalPlanId, { amount: 300 }).expect(201);
    expect((await request(app.getHttpServer()).post(`/api/executions/${queued.body.id}/cancel`).set(auth(userA.token)).expect(201)).body.status).toBe('cancelled');
    expect((await worker.processExecution(queued.body.id)).status).toBe('cancelled');

    const plan = await createPlan(userA.token, definition('运行中取消', [testAction(testConnectionId, 0), record(1)]));
    const running = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'slow' }).expect(201);
    const processing = worker.processExecution(running.body.id);
    await waitForStatus(userA.token, running.body.id, 'running');
    await waitForConnectorCall(`${running.body.id}:0`);
    expect((await request(app.getHttpServer()).post(`/api/executions/${running.body.id}/cancel`).set(auth(userA.token)).expect(201)).body.cancellationRequestedAt).toBeTruthy();
    expect((await processing).status).toBe('partially_succeeded');
    expect((await detail(userA.token, running.body.id)).steps[1].status).toBe('pending');
  });

  it('33 rejects illegal transitions and keeps terminal history immutable', async () => {
    await expect(executionStates.transition(canonicalExecutionId, 'running')).rejects.toThrow(/Terminal/);
    const before = await detail(userA.token, canonicalExecutionId);
    await worker.processExecution(canonicalExecutionId);
    const after = await detail(userA.token, canonicalExecutionId);
    expect(after.finishedAt).toBe(before.finishedAt);
    await expect(pool.query("UPDATE executions SET plan_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)", [canonicalPlanId, canonicalExecutionId])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE execution_steps SET step_order=99 WHERE id=UUID_TO_BIN(?)", [after.steps[0].id])).rejects.toThrow(/identity is immutable|Terminal ExecutionStep/);
    await expect(pool.query("UPDATE executions SET resolved_fallback_policy_json=JSON_OBJECT('strategy','skip_step') WHERE id=UUID_TO_BIN(?)", [canonicalExecutionId])).rejects.toThrow(/immutable/);
  });

  it('34 preserves V1 Execution after V2 is created and applied', async () => {
    const v2Body = definition('金额记录测试', [compare(0), record(1)], 300);
    const v2 = await request(app.getHttpServer()).post(`/api/plans/${canonicalPlanId}/versions`).set(auth(userA.token)).send(v2Body).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${canonicalPlanId}/versions/2/apply`).set(auth(userA.token)).expect(201);
    const e2 = await dispatch(userA.token, canonicalPlanId, { amount: 350 }).expect(201);
    expect(e2.body.planVersionId).toBe(v2.body.id); expect(e2.body.definitionHash).toBe(v2.body.definitionHash);
    await worker.processExecution(e2.body.id);
    const e1 = await detail(userA.token, canonicalExecutionId);
    expect(e1.planVersionId).toBe(canonicalV1Id); expect(e1.definitionHash).toBe(canonicalV1Hash); expect(e1.planVersionNumber).toBe(1);
    const v1 = await request(app.getHttpServer()).get(`/api/plans/${canonicalPlanId}/versions/1`).set(auth(userA.token)).expect(200);
    expect(v1.body.definition.conditions[0].comparisonValue).toBe(200);
  });

  it('35 detects an Execution hash mismatch before running', async () => {
    const valid = await dispatch(userA.token, canonicalPlanId, { amount: 400 }).expect(201);
    const invalidId = randomUUID();
    await pool.query(`INSERT INTO executions (id,user_id,plan_id,plan_version_id,definition_hash,request_id,retry_of_execution_id,trigger_type,trigger_payload_json,status,declared_risk_level,approval_status,execution_policy_version,resolved_retry_policy_json,resolved_fallback_policy_json,result_code,result_summary,error_code,error_message,cancellation_requested_at,queued_at,started_at,finished_at,worker_token,heartbeat_at,lease_expires_at,created_at,updated_at)
      SELECT UUID_TO_BIN(?),user_id,plan_id,plan_version_id,?,CONCAT(request_id,'-invalid'),NULL,trigger_type,trigger_payload_json,'queued',declared_risk_level,approval_status,execution_policy_version,resolved_retry_policy_json,resolved_fallback_policy_json,NULL,NULL,NULL,NULL,NULL,UTC_TIMESTAMP(6),NULL,NULL,NULL,NULL,NULL,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6) FROM executions WHERE id=UUID_TO_BIN(?)`, [invalidId, '0'.repeat(64), valid.body.id]);
    await pool.query(`INSERT INTO execution_steps (id,execution_id,plan_action_id,step_order,action_type,connector_id,connection_id,required_capability,declared_risk_level,status,attempt_count,retry_count,input_snapshot_json,output_snapshot_json,next_retry_at,started_at,finished_at,error_code,error_message,fallback_result_json,created_at,updated_at)
      SELECT UUID_TO_BIN(UUID()),UUID_TO_BIN(?),id,step_order,action_type,connector_id,connection_id,required_capability,risk_level,'pending',0,0,JSON_OBJECT('amount',400),NULL,NULL,NULL,NULL,NULL,NULL,NULL,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6) FROM plan_actions WHERE plan_version_id=(SELECT plan_version_id FROM executions WHERE id=UUID_TO_BIN(?))`, [invalidId, invalidId]);
    await worker.processExecution(invalidId);
    expect((await detail(userA.token, invalidId)).errorCode).toBe('PLAN_DEFINITION_INTEGRITY_ERROR');
    await request(app.getHttpServer()).post(`/api/executions/${valid.body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('36 enforces user isolation for Execution, Steps and cancellation', async () => {
    await request(app.getHttpServer()).get(`/api/executions/${canonicalExecutionId}`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/executions/${canonicalExecutionId}/cancel`).set(auth(userB.token)).expect(404);
    const list = await request(app.getHttpServer()).get('/api/executions').set(auth(userB.token)).expect(200);
    expect(list.body.some((item: { id: string }) => item.id === canonicalExecutionId)).toBe(false);
  });

  it('37 sanitizes trigger/input/output/error snapshots and never exposes Credential references', async () => {
    const plan = await createPlan(userA.token, definition('快照安全', [testAction()]));
    const output = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'secret_output', access_token: 'input-token-must-not-leak' }).expect(201);
    await worker.processExecution(output.body.id);
    const safe = JSON.stringify(await detail(userA.token, output.body.id));
    expect(safe).not.toContain('input-token-must-not-leak'); expect(safe).not.toContain('output-token-must-not-leak'); expect(safe).not.toContain('credential-must-not-leak'); expect(safe).not.toMatch(/credentialRef/i);

    const error = await dispatch(userA.token, plan.id, { amount: 300, behavior: 'secret_error' }).expect(201);
    await worker.processExecution(error.body.id);
    const errorDetail = JSON.stringify(await detail(userA.token, error.body.id));
    expect(errorDetail).not.toContain('raw-secret'); expect(errorDetail).toContain('[REDACTED]');
    await request(app.getHttpServer()).post(`/api/executions/${error.body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('38 has no rerun or physical DELETE API and database rejects history deletion', async () => {
    await request(app.getHttpServer()).post(`/api/executions/${canonicalExecutionId}/rerun`).set(auth(userA.token)).send({ requestId: randomUUID() }).expect(404);
    await request(app.getHttpServer()).delete(`/api/executions/${canonicalExecutionId}`).set(auth(userA.token)).expect(404);
    const row = await detail(userA.token, canonicalExecutionId);
    await request(app.getHttpServer()).delete(`/api/execution_steps/${row.steps[0].id}`).set(auth(userA.token)).expect(404);
    await expect(pool.query('DELETE FROM executions WHERE id=UUID_TO_BIN(?)', [canonicalExecutionId])).rejects.toThrow(/cannot be deleted/);
  });

  it('39 supports real list filters/pagination and ordered Detail Steps', async () => {
    const list = await request(app.getHttpServer()).get(`/api/executions?planId=${canonicalPlanId}&status=succeeded&limit=10&offset=0`).set(auth(userA.token)).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    const row = await detail(userA.token, canonicalExecutionId);
    expect(row.steps.map((step: { stepOrder: number }) => step.stepOrder)).toEqual([...row.steps.map((step: { stepOrder: number }) => step.stepOrder)].sort((a, b) => a - b));
  });

  it('40 confirms migration history and Execution protection triggers', async () => {
    const [migrations] = await pool.query<Array<{ id: number }>>('SELECT id FROM __drizzle_migrations ORDER BY id');
    expect(migrations.map((row) => row.id)).toEqual(expect.arrayContaining([3, 4, 5]));
    const [triggers] = await pool.query<Array<{ TRIGGER_NAME: string }>>("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND (EVENT_OBJECT_TABLE='executions' OR EVENT_OBJECT_TABLE LIKE 'execution_%')");
    expect(triggers.length).toBeGreaterThanOrEqual(9);
  });
});
