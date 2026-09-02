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

class ExtendedTestConnector implements Connector {
  readonly calls = new Map<string, number>();
  constructor(private readonly key: string) {}
  metadata = () => ({ key: this.key, name: 'P0-6 Extended Test', description: 'Test process only', version: '1.0.0-test', connectorSdkVersion: '0.1.0', providerType: 'internal' as const, productionStatus: 'DISABLED' as const, authentication: { type: 'none' as const }, supportsRefresh: false, supportsRevoke: false, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'full' as const, rateLimitStrategy: 'unknown' as const });
  capabilities = () => [
    { key: 'TEST_R2_INTERNAL', name: 'Internal preparation', operation: 'execute' as const, riskLevel: 'R2' as const, requiredPermission: 'TEST_R2_INTERNAL' },
    { key: 'TEST_R3_EXTERNAL', name: 'External visible simulation', operation: 'execute' as const, riskLevel: 'R3' as const, requiredPermission: 'TEST_R3_EXTERNAL' },
  ];
  async validateConnection() { return { status: 'healthy' as const, checkedAt: new Date().toISOString() }; }
  async execute(request: ConnectorRequest) { this.calls.set(request.requestId, (this.calls.get(request.requestId) ?? 0) + 1); return { ok: true, data: { simulated: true } }; }
}

describe.sequential('P0-6 Extended Risk, Approval, Authorization, Notification and runtime safety', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(id: string): Promise<{ status: string }> };
  let approvalService: { expireDue(): Promise<{ expired: number }> };
  let userA: Session;
  let userB: Session;
  let connector: ExtendedTestConnector;
  let connectorKey: string;
  let connectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-extended-credentials-${unique}`;
    const { AppModule } = await import(new URL('../dist/app.module.js', import.meta.url).href);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });
    worker = app.get('EXECUTION_WORKER'); approvalService = app.get('APPROVAL_SERVICE');
    connectorKey = `ext-${unique}`.slice(0, 80); connector = new ExtendedTestConnector(connectorKey);
    app.get<{ register(value: Connector): void }>('CONNECTOR_REGISTRY').register(connector);
    const connectorId = randomUUID();
    await pool.query("INSERT INTO connectors (id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES (UUID_TO_BIN(?),?,'P0-6 Extended Test','active','1.0.0-test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, connectorKey]);
    for (const [key, risk, name] of [['TEST_R2_INTERNAL', 'R2', 'Internal preparation'], ['TEST_R3_EXTERNAL', 'R3', 'External visible simulation']]) {
      await pool.query("INSERT INTO connector_capabilities (id,connector_id,capability_key,name,operation,risk_level,created_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,?,'execute',?,UTC_TIMESTAMP(6))", [connectorId, key, name, risk]);
    }
    userA = await register(`ext-a-${unique}@example.com`); userB = await register(`ext-b-${unique}@example.com`);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(userA.token)).send({ connectorId: connectorKey, externalAccountName: 'P0-6 extended test' }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R2_INTERNAL', granted: true }, { capability: 'TEST_R3_EXTERNAL', granted: true }] }).expect(200);
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function register(email: string): Promise<Session> {
    const result = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName: email.split('@')[0] }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(result.body.accessToken)).expect(200);
    return { token: result.body.accessToken, userId: me.body.id };
  }
  const action = (capability: 'TEST_R2_INTERNAL' | 'TEST_R3_EXTERNAL', stepOrder = 0) => ({ actionType: 'update_internal_record', connectionId, requiredCapability: capability, config: { recordType: 'safety_test' }, stepOrder });
  const definition = (name: string, actions: Array<Record<string, unknown>>, approvalPolicy?: Record<string, unknown>) => ({ name, description: 'P0-6 extended', domain: 'general', automationLevel: 'L2', ...(approvalPolicy ? { approvalPolicy } : {}), sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [], actions });
  async function createPlan(body: Record<string, unknown>) {
    const plan = (await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(body).expect(201)).body;
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/1/apply`).set(auth(userA.token)).expect(201);
    return (await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'active' }).expect(201)).body;
  }
  async function dispatch(planId: string, payload: Record<string, unknown> = {}) { return request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(userA.token)).send({ requestId: `p06e-${unique}-${randomUUID()}`, triggerPayload: payload }).expect(201); }
  async function detail(id: string) { return (await request(app.getHttpServer()).get(`/api/executions/${id}`).set(auth(userA.token)).expect(200)).body; }
  async function runToWait(planId: string, payload: Record<string, unknown> = {}) { const created = await dispatch(planId, payload); expect((await worker.processExecution(created.body.id)).status).toBe('waiting_approval'); return { execution: await detail(created.body.id), approval: (await request(app.getHttpServer()).get('/api/approvals?status=pending').set(auth(userA.token)).expect(200)).body.find((item: { executionId: string }) => item.executionId === created.body.id) }; }
  async function approve(approvalId: string) { await request(app.getHttpServer()).post(`/api/approvals/${approvalId}/approve`).set(auth(userA.token)).send({ deviceId: 'ext-test' }).expect(201); }
  function expectNoSideEffects(executionId: string) { expect(connector.calls.get(`${executionId}:0`) ?? 0).toBe(0); }

  it('prevents client and Plan risk downgrade, freezes the Snapshot and leaves P0-5 legacy rows untouched', async () => {
    // 客户端无法注入 riskLevel：action schema 是 strict，多余字段被拒绝。
    await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send({ ...definition('Client risk downgrade', [{ actionType: 'create_order', connectionId, config: { currency: 'CNY' }, stepOrder: 0 }]), actions: [{ actionType: 'create_order', connectionId, riskLevel: 'R1', config: { currency: 'CNY' }, stepOrder: 0 }] }).expect(400);
    // Plan/客户端都无法把 create_order 降级到 R1：registry floor R4 生效。
    const plan = await createPlan(definition('Registry floor', [{ actionType: 'create_order', connectionId, config: { currency: 'CNY' }, stepOrder: 0 }]));
    const created = await dispatch(plan.id, { amount: '25.00', currency: 'CNY' });
    const row = await detail(created.body.id);
    expect(row.steps[0].effectiveRiskLevel).toBe('R4');
    expect(row.steps[0].riskSnapshotJson.sideEffectClass).toBe('financial_account');
    expect(row.steps[0].riskSnapshotJson.minimumApprovalRequirement).toBe('strong_confirmation');
    expect(row.steps[0].riskSnapshotJson.riskReasonCodes).toContain('monetary_action');
    await request(app.getHttpServer()).post(`/api/executions/${created.body.id}/cancel`).set(auth(userA.token)).expect(201);

    // Input fingerprint 受 DB 层 immutable 保护：任何试图篡改 Step 输入指纹的写入都会被拒绝。
    const fpPlan = await createPlan(definition('Fingerprint freeze', [action('TEST_R3_EXTERNAL')]));
    const fp = await runToWait(fpPlan.id, { token: 'must-not-leak' });
    await expect(pool.query("UPDATE execution_steps SET input_fingerprint='deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE id=UUID_TO_BIN(?)", [fp.execution.steps[0].id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE execution_steps SET risk_snapshot_json=JSON_OBJECT('tampered',1) WHERE id=UUID_TO_BIN(?)", [fp.execution.steps[0].id])).rejects.toThrow(/immutable/);
    await request(app.getHttpServer()).post(`/api/executions/${fp.execution.id}/cancel`).set(auth(userA.token)).expect(201);

    // P0-5 Legacy 记录：无 Risk Snapshot，保持 null 不回填。
    const legacy = randomUUID();
    const [planRow] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT id,user_id FROM plans WHERE user_id=UUID_TO_BIN(?) LIMIT 1", [userA.userId]);
    const [versionRow] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT id FROM plan_versions WHERE plan_id=? ORDER BY version_number DESC LIMIT 1", [planRow[0].id]);
    await pool.query("INSERT INTO executions (id,user_id,plan_id,plan_version_id,definition_hash,request_id,trigger_type,trigger_payload_json,status,declared_risk_level,approval_status,execution_policy_version,resolved_retry_policy_json,resolved_fallback_policy_json,created_at,updated_at) VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,'legacy-hash','legacy-request','manual',JSON_OBJECT(),'succeeded','R0','not_requested','p0-5','{}','{}',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [legacy, userA.userId, planRow[0].id, versionRow[0].id]);
    const legacyDetail = await detail(legacy);
    expect(legacyDetail.riskPolicyVersion).toBeNull();
    expect(legacyDetail.resolvedRiskSnapshotJson).toBeNull();
    const [legacyRow] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT risk_policy_version FROM executions WHERE id=UUID_TO_BIN(?)", [legacy]);
    expect(legacyRow[0].risk_policy_version).toBeNull();
  });

  it('rechecks Connection, Permission, Credential, Plan and input after Approval and stops safely', async () => {
    // Connection revoked
    let plan = await createPlan(definition('Runtime revoke connection', [action('TEST_R3_EXTERNAL')]));
    let waiting = await runToWait(plan.id); await approve(waiting.approval.id);
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(userA.token)).expect(204);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('failed');
    expect((await detail(waiting.execution.id)).errorCode).toBe('CONNECTION_REVOKED'); expectNoSideEffects(waiting.execution.id);
    // 恢复连接供后续用例使用
    await pool.query("UPDATE connections SET status='connected' WHERE id=UUID_TO_BIN(?)", [connectionId]);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R2_INTERNAL', granted: true }, { capability: 'TEST_R3_EXTERNAL', granted: true }] }).expect(200);

    // Permission revoked
    plan = await createPlan(definition('Runtime revoke permission', [action('TEST_R3_EXTERNAL')]));
    waiting = await runToWait(plan.id); await approve(waiting.approval.id);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R3_EXTERNAL', granted: false }] }).expect(200);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('failed');
    expect((await detail(waiting.execution.id)).errorCode).toBe('PERMISSION_REVOKED'); expectNoSideEffects(waiting.execution.id);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R2_INTERNAL', granted: true }, { capability: 'TEST_R3_EXTERNAL', granted: true }] }).expect(200);

    // Credential expired（挂一个已过期凭据引用）
    plan = await createPlan(definition('Runtime credential expired', [action('TEST_R3_EXTERNAL')]));
    waiting = await runToWait(plan.id); await approve(waiting.approval.id);
    await pool.query("INSERT INTO credential_refs (id,credential_ref,provider,status,expires_at,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),?, 'test','active',DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [`ext-expired-${unique}-${randomUUID()}`]);
    await pool.query("UPDATE connections SET credential_ref_id=(SELECT id FROM credential_refs ORDER BY created_at DESC LIMIT 1) WHERE id=UUID_TO_BIN(?)", [connectionId]);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('failed');
    expect((await detail(waiting.execution.id)).errorCode).toBe('CREDENTIAL_EXPIRED'); expectNoSideEffects(waiting.execution.id);
    await pool.query("UPDATE connections SET credential_ref_id=NULL WHERE id=UUID_TO_BIN(?)", [connectionId]);

    // Plan paused
    plan = await createPlan(definition('Runtime plan paused', [action('TEST_R3_EXTERNAL')]));
    waiting = await runToWait(plan.id); await approve(waiting.approval.id);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'paused' }).expect(201);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('cancelled');
    expect((await detail(waiting.execution.id)).resultCode).toBe('PLAN_NOT_ACTIVE'); expectNoSideEffects(waiting.execution.id);

    // Plan archived
    plan = await createPlan(definition('Runtime plan archived', [action('TEST_R3_EXTERNAL')]));
    waiting = await runToWait(plan.id); await approve(waiting.approval.id);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'paused' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'archived' }).expect(201);
    expect((await worker.processExecution(waiting.execution.id)).status).toBe('cancelled');
    expect((await detail(waiting.execution.id)).resultCode).toBe('PLAN_NOT_ACTIVE'); expectNoSideEffects(waiting.execution.id);
  });

  it('rejects Temporary Authorization as soon as it is revoked, and never lets R4 skip strong approval', async () => {
    const plan = await createPlan(definition('Authorization revocation', [action('TEST_R2_INTERNAL')], { type: 'temporary_authorization' }));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const authorization = (await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: plan.activeVersionId, connectionId, capabilityKey: 'TEST_R2_INTERNAL', maximumRiskLevel: 'R2', expiresAt }).expect(201)).body;
    const first = await dispatch(plan.id); expect((await worker.processExecution(first.body.id)).status).toBe('succeeded');
    await request(app.getHttpServer()).post(`/api/temporary-authorizations/${authorization.id}/revoke`).set(auth(userA.token)).expect(201);
    const second = await runToWait(plan.id);
    expect(second.approval).toBeTruthy();
    await request(app.getHttpServer()).post(`/api/executions/${second.execution.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('enforces amount limit and currency/capability scope on Temporary Authorization without touching the connector', async () => {
    const plan = await createPlan(definition('Authorization amount scope', [{ actionType: 'prepare_purchase', connectionId, config: { currency: 'CNY' }, stepOrder: 0 }], { type: 'temporary_authorization' }));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    // 无 capability 的金额型授权：命中但真实副作用仍被 P0-7 Gate 阻断。
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: plan.activeVersionId, connectionId, maximumRiskLevel: 'R3', amountLimitMinor: 5000, currency: 'CNY', expiresAt }).expect(201);
    const inLimit = await dispatch(plan.id, { amount: '20.00', currency: 'CNY' });
    expect((await worker.processExecution(inLimit.body.id)).status).toBe('failed');
    expect((await detail(inLimit.body.id)).errorCode).toBe('SAFETY_GATE_REQUIRES_IDEMPOTENCY');
    expectNoSideEffects(inLimit.body.id);
    // 超限 → 授权不命中 → 需确认。
    const overLimit = await runToWait(plan.id, { amount: '60.00', currency: 'CNY' });
    await request(app.getHttpServer()).post(`/api/executions/${overLimit.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    // 币种不匹配 → 授权不命中。
    const wrongCurrency = await runToWait(plan.id, { amount: '20.00', currency: 'USD' });
    await request(app.getHttpServer()).post(`/api/executions/${wrongCurrency.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    // capability 维度隔离：授权的是 TEST_R3_EXTERNAL，动作是 TEST_R2_INTERNAL → 不命中。
    const capabilityPlan = await createPlan(definition('Authorization capability scope', [action('TEST_R2_INTERNAL')], { type: 'temporary_authorization' }));
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: capabilityPlan.activeVersionId, connectionId, capabilityKey: 'TEST_R3_EXTERNAL', maximumRiskLevel: 'R3', expiresAt }).expect(201);
    const wrongCapability = await runToWait(capabilityPlan.id);
    await request(app.getHttpServer()).post(`/api/executions/${wrongCapability.execution.id}/cancel`).set(auth(userA.token)).expect(201);
    // 跨用户：B 不能为 A 的 PlanVersion 创建授权。
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userB.token)).send({ planVersionId: plan.activeVersionId, connectionId, maximumRiskLevel: 'R3', expiresAt }).expect(404);
  });

  it('keeps Approval Policy on the PlanVersion and snapshots it per Execution', async () => {
    const plan = await createPlan(definition('Policy versioning V1 never', [{ actionType: 'compare', config: {}, stepOrder: 0 }], { type: 'never' }));
    const v1Execution = await dispatch(plan.id); expect((await worker.processExecution(v1Execution.body.id)).status).toBe('succeeded');
    const v1Detail = await detail(v1Execution.body.id);
    expect(v1Detail.resolvedApprovalPolicyJson.type).toBe('never');
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions`).set(auth(userA.token)).send(definition('Policy versioning V2 always', [{ actionType: 'compare', config: {}, stepOrder: 0 }], { type: 'always' })).expect(201);
    const applied = (await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/2/apply`).set(auth(userA.token)).expect(201)).body;
    const v2 = await runToWait(plan.id);
    expect((await request(app.getHttpServer()).get(`/api/approvals/${v2.approval.id}`).set(auth(userA.token)).expect(200)).body.policySnapshotJson.type).toBe('always');
    expect(applied.activeVersionId).not.toBe(plan.activeVersionId);
    await request(app.getHttpServer()).post(`/api/executions/${v2.execution.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('supports Notification P2, read, archive, unread-count and cross-user isolation without leaking secrets', async () => {
    const plan = await createPlan(definition('Notification lifecycle', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id, { token: 'must-not-leak', secret: 's3cr3t' });
    // P1 审批通知不含凭据。
    const p1 = (await request(app.getHttpServer()).get('/api/notifications?priority=P1').set(auth(userA.token)).expect(200)).body.filter((item: { executionId: string }) => item.executionId === waiting.execution.id);
    expect(p1).toHaveLength(1);
    expect(JSON.stringify(p1)).not.toContain('must-not-leak');
    expect(JSON.stringify(p1)).not.toContain('s3cr3t');
    expect(JSON.stringify(p1)).not.toContain('stack');

    const before = (await request(app.getHttpServer()).get('/api/notifications/unread-count').set(auth(userA.token)).expect(200)).body.count;
    // 拒绝 → P2 通知。
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/reject`).set(auth(userA.token)).send({ reason: '不需要', deviceId: 'ext' }).expect(201);
    const p2 = (await request(app.getHttpServer()).get('/api/notifications?priority=P2').set(auth(userA.token)).expect(200)).body.filter((item: { executionId: string }) => item.executionId === waiting.execution.id && item.eventType === 'approval_rejected');
    expect(p2).toHaveLength(1);
    expect(JSON.stringify(p2)).not.toContain('must-not-leak');
    // 跨用户：B 不能读 A 的通知，unread-count 也不含 A 的。
    await request(app.getHttpServer()).post(`/api/notifications/${p1[0].id}/read`).set(auth(userB.token)).expect(404);
    const bCount = (await request(app.getHttpServer()).get('/api/notifications/unread-count').set(auth(userB.token)).expect(200)).body.count;
    expect(bCount).toBe(0);
    // read → unread-count 递减。
    await request(app.getHttpServer()).post(`/api/notifications/${p1[0].id}/read`).set(auth(userA.token)).expect(201);
    const after = (await request(app.getHttpServer()).get('/api/notifications/unread-count').set(auth(userA.token)).expect(200)).body.count;
    expect(after).toBe(before);
    // archive → 返回体带 archived 状态与时间，list 隐藏。
    const unreadOnlyBefore = (await request(app.getHttpServer()).get('/api/notifications?unread=true').set(auth(userA.token)).expect(200)).body.filter((item: { executionId: string }) => item.executionId === waiting.execution.id);
    const archivedResponse = await request(app.getHttpServer()).post(`/api/notifications/${unreadOnlyBefore[0].id}/archive`).set(auth(userA.token)).expect(201);
    expect(archivedResponse.body.status).toBe('archived');
    expect(archivedResponse.body.archivedAt).toBeTruthy();
    const listed = (await request(app.getHttpServer()).get('/api/notifications').set(auth(userA.token)).expect(200)).body;
    expect(listed.find((item: { id: string }) => item.id === unreadOnlyBefore[0].id)).toBeUndefined();
  });

  it('expires Approval through the scheduler and never re-generates an infinite chain', async () => {
    const plan = await createPlan(definition('Expiry fallback', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await wait(2_100); await approvalService.expireDue();
    const after = await detail(waiting.execution.id);
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('APPROVAL_EXPIRED');
    // 过期后 Worker 再次触碰该 Step 不得重新生成 Approval（终态）。
    const [requests] = await pool.query<import('mysql2').RowDataPacket[]>("SELECT COUNT(*) count FROM approval_requests WHERE execution_id=UUID_TO_BIN(?)", [waiting.execution.id]);
    expect(requests[0].count).toBe(1);
    expectNoSideEffects(waiting.execution.id);
  });
});
