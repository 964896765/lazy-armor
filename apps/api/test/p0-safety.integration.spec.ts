import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Connector, ConnectorRequest } from '@lazy-armor/connector-sdk';
import { createPool, type Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
interface Session { token: string; userId: string }

class SafetyTestConnector implements Connector {
  readonly calls = new Map<string, number>();
  constructor(private readonly key: string) {}
  metadata = () => ({ key: this.key, name: 'P0-6 Safety Test', description: 'Test process only', version: '1.0.0-test' });
  capabilities = () => [
    { key: 'TEST_R2_INTERNAL', name: 'Internal preparation', operation: 'execute' as const, riskLevel: 'R2' as const },
    { key: 'TEST_R3_EXTERNAL', name: 'External visible simulation', operation: 'execute' as const, riskLevel: 'R3' as const },
    { key: 'TEST_R4_EXTERNAL', name: 'Financial account simulation', operation: 'execute' as const, riskLevel: 'R4' as const },
  ];
  async validateConnection() { return { status: 'healthy' as const, checkedAt: new Date().toISOString() }; }
  async execute(request: ConnectorRequest) { this.calls.set(request.requestId, (this.calls.get(request.requestId) ?? 0) + 1); return { ok: true, data: { simulated: true } }; }
}

describe.sequential('P0-6 Risk, Approval and Notification integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(id: string): Promise<{ status: string }> };
  let approvalService: { expireDue(): Promise<{ expired: number }> };
  let outboxWorker: { poll(): Promise<{ claimed: number; processed: number }> };
  let userA: Session;
  let userB: Session;
  let connector: SafetyTestConnector;
  let connectorKey: string;
  let connectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-safety-credentials-${unique}`;
    const { AppModule } = await import('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });
    worker = app.get('EXECUTION_WORKER'); approvalService = app.get('APPROVAL_SERVICE'); outboxWorker = app.get('OUTBOX_WORKER');
    connectorKey = `safety-${unique}`.slice(0, 80); connector = new SafetyTestConnector(connectorKey);
    app.get<{ register(value: Connector): void }>('CONNECTOR_REGISTRY').register(connector);
    const connectorId = randomUUID();
    await pool.query("INSERT INTO connectors (id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES (UUID_TO_BIN(?),?,'P0-6 Safety Test','active','1.0.0-test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, connectorKey]);
    for (const [key, risk, name] of [['TEST_R2_INTERNAL', 'R2', 'Internal preparation'], ['TEST_R3_EXTERNAL', 'R3', 'External visible simulation'], ['TEST_R4_EXTERNAL', 'R4', 'Financial account simulation']]) {
      await pool.query("INSERT INTO connector_capabilities (id,connector_id,capability_key,name,operation,risk_level,created_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,?,'execute',?,UTC_TIMESTAMP(6))", [connectorId, key, name, risk]);
    }
    userA = await register(`safety-a-${unique}@example.com`); userB = await register(`safety-b-${unique}@example.com`);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(userA.token)).send({ connectorId: connectorKey, externalAccountName: 'P0-6 internal test' }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R2_INTERNAL', granted: true }, { capability: 'TEST_R3_EXTERNAL', granted: true }, { capability: 'TEST_R4_EXTERNAL', granted: true }] }).expect(200);
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function register(email: string): Promise<Session> {
    const result = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName: email.split('@')[0] }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(result.body.accessToken)).expect(200);
    return { token: result.body.accessToken, userId: me.body.id };
  }
  const action = (capability: 'TEST_R2_INTERNAL' | 'TEST_R3_EXTERNAL' | 'TEST_R4_EXTERNAL', stepOrder = 0) => ({ actionType: 'update_internal_record', connectionId, requiredCapability: capability, config: { recordType: 'safety_test' }, stepOrder });
  const definition = (name: string, actions: Array<Record<string, unknown>>, approvalPolicy?: Record<string, unknown>) => ({ name, description: 'P0-6 integration', domain: 'general', automationLevel: 'L2', ...(approvalPolicy ? { approvalPolicy } : {}), sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [], actions });
  async function createPlan(body: Record<string, unknown>) {
    const plan = (await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(body).expect(201)).body;
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/1/apply`).set(auth(userA.token)).expect(201);
    return (await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'active' }).expect(201)).body;
  }
  async function dispatch(planId: string, payload: Record<string, unknown> = {}) { return request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(userA.token)).send({ requestId: `p06-${unique}-${randomUUID()}`, triggerPayload: payload }).expect(201); }
  async function detail(id: string) { return (await request(app.getHttpServer()).get(`/api/executions/${id}`).set(auth(userA.token)).expect(200)).body; }
  async function runToWait(planId: string, payload: Record<string, unknown> = {}) { const created = await dispatch(planId, payload); expect((await worker.processExecution(created.body.id)).status).toBe('waiting_approval'); return { execution: await detail(created.body.id), approval: (await request(app.getHttpServer()).get('/api/approvals?status=pending').set(auth(userA.token)).expect(200)).body.find((item: { executionId: string }) => item.executionId === created.body.id) }; }

  it('1-5 maps R0-R4 deterministically and prevents declared/capability risk downgrade', async () => {
    const bodies = [
      definition('Risk R0', [{ actionType: 'compare', config: {}, stepOrder: 0 }]),
      definition('Risk R1', [{ actionType: 'record', config: {}, stepOrder: 0 }]),
      definition('Risk R2', [action('TEST_R2_INTERNAL')]),
      definition('Risk R3', [action('TEST_R3_EXTERNAL')]),
      definition('Risk R4', [{ actionType: 'create_order', connectionId, config: { currency: 'CNY' }, stepOrder: 0 }]),
    ];
    for (const [index, body] of bodies.entries()) {
      const plan = await createPlan(body); const created = await dispatch(plan.id, { amount: 25 }); const row = await detail(created.body.id);
      expect(row.steps[0].effectiveRiskLevel).toBe(`R${index}`); expect(row.steps[0].riskSnapshotJson.policyVersion).toBe('p0-6-risk-v1');
      await request(app.getHttpServer()).post(`/api/executions/${created.body.id}/cancel`).set(auth(userA.token)).expect(201);
    }
  });

  it('6 runs R0 automatically and keeps ordinary success P3-silent', async () => {
    const plan = await createPlan(definition('Demo A R0', [{ actionType: 'compare', config: {}, stepOrder: 0 }])); const created = await dispatch(plan.id, { amount: 1 });
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const notifications = (await request(app.getHttpServer()).get('/api/notifications').set(auth(userA.token)).expect(200)).body;
    expect(notifications.filter((item: { executionId: string }) => item.executionId === created.body.id)).toHaveLength(0);
  });

  it('7 supports always, first_time, above_risk_level, above_amount and per_execution without lowering the system floor', async () => {
    for (const [type, actionBody, policy, payload] of [
      ['always', { actionType: 'compare', config: {}, stepOrder: 0 }, { type: 'always' }, {}],
      ['above_risk_level', { actionType: 'record', config: {}, stepOrder: 0 }, { type: 'above_risk_level', config: { riskLevel: 'R0' } }, {}],
      ['above_amount', { actionType: 'prepare_purchase', config: { currency: 'CNY' }, stepOrder: 0 }, { type: 'above_amount', config: { amountMinor: 1000, currency: 'CNY' } }, { amount: '20.00', currency: 'CNY' }],
      ['per_execution', { actionType: 'compare', config: {}, stepOrder: 0 }, { type: 'per_execution' }, {}],
    ] as const) {
      const plan = await createPlan(definition(`Policy ${type}`, [actionBody], policy)); const waiting = await runToWait(plan.id, payload); expect(waiting.approval).toBeTruthy();
      await request(app.getHttpServer()).post(`/api/executions/${waiting.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    }
    const firstPlan = await createPlan(definition('Policy first_time', [{ actionType: 'compare', config: {}, stepOrder: 0 }], { type: 'first_time' }));
    const first = await runToWait(firstPlan.id); await request(app.getHttpServer()).post(`/api/approvals/${first.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'test' }).expect(201); expect((await worker.processExecution(first.execution.id)).status).toBe('succeeded');
    const second = await dispatch(firstPlan.id); expect((await worker.processExecution(second.body.id)).status).toBe('succeeded');
  });

  it('8-10 creates one R3 Approval and P1 Notification, resumes only through Worker, then executes the side effect once through the Outbox', async () => {
    const plan = await createPlan(definition('Demo B R3', [action('TEST_R3_EXTERNAL')])); const waiting = await runToWait(plan.id);
    expect(waiting.execution.steps[0].attemptCount).toBe(0); expect(waiting.execution.approvalStatus).toBe('pending');
    const p1 = (await request(app.getHttpServer()).get('/api/notifications?priority=P1').set(auth(userA.token)).expect(200)).body.filter((item: { executionId: string }) => item.executionId === waiting.execution.id); expect(p1).toHaveLength(1);
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'phone-a' }).expect(201);
    expect(connector.calls.get(`${waiting.execution.id}:0`) ?? 0).toBe(0);
    // 批准后：Execution 进入 waiting_dispatch，由 Outbox Worker 执行 Test Connector，副作用恰好一次。
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('waiting_dispatch');
    const afterWorker = await detail(waiting.execution.id);
    expect(afterWorker.status).toBe('waiting_dispatch');
    await outboxWorker.poll();
    const final = await detail(waiting.execution.id);
    expect(final.status).toBe('succeeded');
    expect(connector.calls.get(`${waiting.execution.id}:0`) ?? 0).toBe(1);
    const p0 = (await request(app.getHttpServer()).get('/api/notifications?priority=P0').set(auth(userA.token)).expect(200)).body.filter((item: { executionId: string }) => item.executionId === waiting.execution.id); expect(p0).toHaveLength(0);
  });

  it('11 routes Reject through bounded Fallback and produces one terminal Decision', async () => {
    const plan = await createPlan(definition('Demo C Reject', [action('TEST_R3_EXTERNAL')])); const waiting = await runToWait(plan.id);
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/reject`).set(auth(userA.token)).send({ reason: '不执行', deviceId: 'phone' }).expect(201);
    expect(await detail(waiting.execution.id)).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_REJECTED' });
    const approval = (await request(app.getHttpServer()).get(`/api/approvals/${waiting.approval.id}`).set(auth(userA.token)).expect(200)).body;
    expect(approval.status).toBe('rejected'); expect(approval.decisions).toHaveLength(1);
  });

  it('12-15 scopes Temporary Authorization to V1/Connection/Capability/Risk/expiry/revocation and never R4', async () => {
    const plan = await createPlan(definition('Demo D Temporary Authorization', [action('TEST_R2_INTERNAL')], { type: 'temporary_authorization' }));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const authorization = (await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: plan.activeVersionId, connectionId, capabilityKey: 'TEST_R2_INTERNAL', maximumRiskLevel: 'R2', expiresAt }).expect(201)).body;
    const v1 = await dispatch(plan.id); expect((await worker.processExecution(v1.body.id)).status).toBe('succeeded');
    const v2Body = definition('Demo D Temporary Authorization', [action('TEST_R2_INTERNAL')], { type: 'temporary_authorization' }); await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions`).set(auth(userA.token)).send(v2Body).expect(201); const appliedV2 = (await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/2/apply`).set(auth(userA.token)).expect(201)).body;
    const v2 = await runToWait(plan.id); await request(app.getHttpServer()).post(`/api/executions/${v2.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/temporary-authorizations/${authorization.id}/revoke`).set(auth(userA.token)).expect(201);
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: appliedV2.activeVersionId, connectionId, capabilityKey: 'TEST_R2_INTERNAL', maximumRiskLevel: 'R2', expiresAt: new Date(Date.now() + 300).toISOString() }).expect(201); await wait(400);
    const expired = await runToWait(plan.id); await request(app.getHttpServer()).post(`/api/executions/${expired.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    const revokeV2 = (await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: appliedV2.activeVersionId, connectionId, capabilityKey: 'TEST_R2_INTERNAL', maximumRiskLevel: 'R2', expiresAt }).expect(201)).body;
    await request(app.getHttpServer()).post(`/api/temporary-authorizations/${revokeV2.id}/revoke`).set(auth(userA.token)).expect(201);
    const revoked = await runToWait(plan.id); await request(app.getHttpServer()).post(`/api/executions/${revoked.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: appliedV2.activeVersionId, connectionId, capabilityKey: 'TEST_R2_INTERNAL', maximumRiskLevel: 'R4', expiresAt }).expect(400);
    const r3Plan = await createPlan(definition('Temporary Authorization R3 remains behind P0-7', [action('TEST_R3_EXTERNAL')], { type: 'temporary_authorization' }));
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: r3Plan.activeVersionId, connectionId, capabilityKey: 'TEST_R3_EXTERNAL', maximumRiskLevel: 'R3', expiresAt }).expect(201);
    const r3 = await dispatch(r3Plan.id);
    expect((await worker.processExecution(r3.body.id)).status).toBe('waiting_dispatch');
    await outboxWorker.poll();
    expect((await detail(r3.body.id)).status).toBe('succeeded');
    expect(connector.calls.get(`${r3.body.id}:0`) ?? 0).toBe(1);
  });

  it('16 allows exactly one Decision for double Approve and Approve/Reject races', async () => {
    for (const race of [['approve', 'approve'], ['approve', 'reject']] as const) {
      const plan = await createPlan(definition(`Decision race ${race.join('-')}`, [{ actionType: 'compare', config: {}, stepOrder: 0 }], { type: 'always' })); const waiting = await runToWait(plan.id);
      const results = await Promise.all(race.map((decision, index) => request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/${decision}`).set(auth(userA.token)).send({ deviceId: `device-${index}` })));
      expect(results.filter((result) => result.status === 201)).toHaveLength(1); expect(results.filter((result) => result.status === 409)).toHaveLength(1);
      const final = (await request(app.getHttpServer()).get(`/api/approvals/${waiting.approval.id}`).set(auth(userA.token)).expect(200)).body; expect(final.decisions).toHaveLength(1);
      if (final.status === 'approved') await worker.processExecution(waiting.execution.id);
    }
  });

  it('17 makes Worker recovery idempotent for Approval and Notification', async () => {
    const plan = await createPlan(definition('Approval recovery', [action('TEST_R3_EXTERNAL')])); const waiting = await runToWait(plan.id);
    await pool.query("UPDATE executions SET status='running',worker_token='dead-worker',heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 SECOND) WHERE id=UUID_TO_BIN(?)", [waiting.execution.id]);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('waiting_approval');
    const [requests] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT COUNT(*) count FROM approval_requests WHERE execution_id=UUID_TO_BIN(?)", [waiting.execution.id]);
    const [notifications] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT COUNT(*) count FROM notifications WHERE execution_id=UUID_TO_BIN(?) AND event_type='approval_required'", [waiting.execution.id]);
    expect(requests[0].count).toBe(1); expect(notifications[0].count).toBe(1);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.execution.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('18 expires Approval safely, makes terminal history immutable and cancels pending Approval with Execution', async () => {
    const expiringPlan = await createPlan(definition('Approval expiry', [action('TEST_R3_EXTERNAL')])); const expiring = await runToWait(expiringPlan.id); await wait(2_100); await approvalService.expireDue();
    expect((await request(app.getHttpServer()).get(`/api/approvals/${expiring.approval.id}`).set(auth(userA.token)).expect(200)).body.status).toBe('expired');
    await expect(pool.query("UPDATE approval_requests SET status='approved' WHERE id=UUID_TO_BIN(?)", [expiring.approval.id])).rejects.toThrow(/immutable/);
    const cancelPlan = await createPlan(definition('Approval cancellation', [action('TEST_R3_EXTERNAL')])); const cancel = await runToWait(cancelPlan.id); await request(app.getHttpServer()).post(`/api/executions/${cancel.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    const cancelled = (await request(app.getHttpServer()).get(`/api/approvals/${cancel.approval.id}`).set(auth(userA.token)).expect(200)).body; expect(cancelled.status).toBe('cancelled'); expect(cancelled.decisions).toHaveLength(1);
  });

  it('19 enforces R4 strong confirmation and then runs the R4 mock side effect once through the Outbox', async () => {
    const plan = await createPlan(definition('R4 strong confirmation', [action('TEST_R4_EXTERNAL')])); const waiting = await runToWait(plan.id, { amount: 100 });
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'phone' }).expect(400);
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'phone', confirmation: 'APPROVE_R4' }).expect(201);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('waiting_dispatch');
    await outboxWorker.poll();
    const final = await detail(waiting.execution.id);
    expect(final.status).toBe('succeeded');
    expect(connector.calls.get(`${waiting.execution.id}:0`) ?? 0).toBe(1);
  });

  it('20 isolates users, redacts secrets, protects snapshots and serves real Today data', async () => {
    const plan = await createPlan(definition('Safety isolation', [action('TEST_R3_EXTERNAL')])); const waiting = await runToWait(plan.id, { token: 'must-not-leak', amount: 10 });
    await request(app.getHttpServer()).get(`/api/approvals/${waiting.approval.id}`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userB.token)).send({}).expect(404);
    expect(JSON.stringify(waiting.execution)).not.toContain('must-not-leak');
    await expect(pool.query("UPDATE execution_steps SET effective_risk_level='R0' WHERE id=UUID_TO_BIN(?)", [waiting.execution.steps[0].id])).rejects.toThrow(/immutable/);
    const today = (await request(app.getHttpServer()).get('/api/today').set(auth(userA.token)).expect(200)).body; expect(today.pendingApprovals.some((item: { id: string }) => item.id === waiting.approval.id)).toBe(true); expect(today.alerts.some((item: { priority: string }) => item.priority === 'P1')).toBe(true);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.execution.id}/cancel`).set(auth(userA.token)).expect(201);
  });
});
