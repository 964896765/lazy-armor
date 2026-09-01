import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Connector, ConnectorRequest } from '@lazy-armor/connector-sdk';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionRuntimeError } from '../dist/execution/execution.types.js';
import { hashPayload } from '../dist/execution/side-effect/idempotency.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
interface Session { token: string; userId: string }

type FaultMode = 'ok' | 'timeout-once' | 'timeout-twice' | 'timeout-always' | 'http500' | 'rate-limit-once' | 'reject';

// P0-7 Test Connector：Provider 侧幂等语义（同 key 不产生第二个副作用）+ 故障注入 + Side Effect Contract。
class P07TestConnector implements Connector {
  readonly calls = new Map<string, number>();
  readonly sideEffects = new Map<string, number>();
  readonly receivedKeys = new Map<string, string[]>();
  readonly appliedKeys = new Set<string>();
  readonly modes = new Map<string, FaultMode>();
  constructor(private readonly key: string) {}
  metadata = () => ({ key: this.key, name: 'P0-7 Side Effect Test', description: 'Test process only', version: '1.0.0-test' });
  capabilities = () => [
    { key: 'TEST_R3_EXTERNAL', name: 'R3 external', operation: 'execute' as const, riskLevel: 'R3' as const, sideEffectContract: { supportsIdempotencyKey: true, retrySafety: 'safe' as const } },
    { key: 'TEST_R3_LOOKUP', name: 'R3 lookup', operation: 'execute' as const, riskLevel: 'R3' as const, sideEffectContract: { supportsIdempotencyKey: true, supportsOperationLookup: true, retrySafety: 'safe' as const } },
    { key: 'TEST_R3_UNSAFE', name: 'R3 unsafe', operation: 'execute' as const, riskLevel: 'R3' as const, sideEffectContract: { supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'unsafe' as const } },
    { key: 'TEST_R4_EXTERNAL', name: 'R4 external', operation: 'execute' as const, riskLevel: 'R4' as const, sideEffectContract: { supportsIdempotencyKey: true, retrySafety: 'safe' as const } },
  ];
  async validateConnection() { return { status: 'healthy' as const, checkedAt: new Date().toISOString() }; }
  setMode(capability: string, mode: FaultMode) { this.modes.set(capability, mode); }
  reset() { this.modes.clear(); this.calls.clear(); this.sideEffects.clear(); this.receivedKeys.clear(); this.appliedKeys.clear(); }
  async execute(request: ConnectorRequest) {
    const capability = request.capability;
    this.calls.set(capability, (this.calls.get(capability) ?? 0) + 1);
    const keys = this.receivedKeys.get(capability) ?? [];
    keys.push(request.idempotencyKey ?? '');
    this.receivedKeys.set(capability, keys);
    const mode = this.modes.get(capability) ?? 'ok';
    if (mode === 'timeout-once' && keys.length === 1) throw new ExecutionRuntimeError('TIMEOUT', 'request sent but read timed out');
    if (mode === 'timeout-twice' && keys.length <= 2) throw new ExecutionRuntimeError('TIMEOUT', 'request sent but read timed out');
    if (mode === 'timeout-always') throw new ExecutionRuntimeError('TIMEOUT', 'request sent but read timed out');
    if (mode === 'http500') throw new ExecutionRuntimeError('PROVIDER_5XX', 'provider returned HTTP 500');
    if (mode === 'rate-limit-once' && keys.length === 1) throw new ExecutionRuntimeError('RATE_LIMIT', 'provider rate limited');
    if (mode === 'reject') return { ok: false, data: { reason: 'provider rejected' } };
    // Provider 官方幂等：同 key 命中已应用 → 不产生第二个副作用。
    const key = request.idempotencyKey ?? request.requestId;
    if (this.appliedKeys.has(key)) return { ok: true, data: { simulated: true, deduped: true } };
    this.appliedKeys.add(key);
    this.sideEffects.set(capability, (this.sideEffects.get(capability) ?? 0) + 1);
    return { ok: true, data: { simulated: true, providerOperationId: `op-${key.slice(0, 12)}` } };
  }
}

interface OperationRow { id: string; executionStepId: string; executionId: string; status: string; idempotencyKey: string; inputFingerprint: string; providerIdempotencyKey: string | null; attemptCount: number; errorCode: string | null; correlationId: string; causationId: string | null }
interface OutboxRow { id: string; aggregateId: string; status: string; dedupeKey: string; payloadHash: string; payloadJson: unknown; attemptCount: number; nextAttemptAt: Date; lastErrorCode: string | null; correlationId: string; causationId: string | null }

describe.sequential('P0-7 Audit, Action Idempotency, Transactional Outbox and Side Effect Safety', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(id: string): Promise<{ status: string }> };
  let outboxWorker: { poll(): Promise<{ claimed: number; processed: number }>; process(message: unknown): Promise<void> };
  let ops: { prepare(input: Record<string, unknown>, executor?: unknown): Promise<{ id: string; idempotencyKey: string; conflict: boolean }>; keyFor(input: Record<string, unknown>): string };
  let outbox: { enqueue(input: Record<string, unknown>, executor?: unknown): Promise<string>; claim(batch: number, workerId: string, leaseMs?: number): Promise<OutboxRow[]>; get(id: string): Promise<OutboxRow | null> };
  let userA: Session;
  let userB: Session;
  let connector: P07TestConnector;
  let connectorKey: string;
  let connectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-p07-credentials-${unique}`;
    const { AppModule } = await import('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3, timezone: 'Z' });
    worker = app.get('EXECUTION_WORKER');
    outboxWorker = app.get('OUTBOX_WORKER');
    ops = app.get('SIDE_EFFECT_OPERATIONS_SERVICE');
    outbox = app.get('OUTBOX_SERVICE');
    connectorKey = `p07-${unique}`.slice(0, 80); connector = new P07TestConnector(connectorKey);
    app.get<{ register(value: Connector): void }>('CONNECTOR_REGISTRY').register(connector);
    const connectorId = randomUUID();
    await pool.query("INSERT INTO connectors (id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES (UUID_TO_BIN(?),?,'P0-7 Side Effect Test','active','1.0.0-test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, connectorKey]);
    for (const [key, risk, name] of [['TEST_R3_EXTERNAL', 'R3', 'R3 external'], ['TEST_R3_LOOKUP', 'R3', 'R3 lookup'], ['TEST_R3_UNSAFE', 'R3', 'R3 unsafe'], ['TEST_R4_EXTERNAL', 'R4', 'R4 external']]) {
      await pool.query("INSERT INTO connector_capabilities (id,connector_id,capability_key,name,operation,risk_level,created_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,?,'execute',?,UTC_TIMESTAMP(6))", [connectorId, key, name, risk]);
    }
    userA = await register(`p07-a-${unique}@example.com`); userB = await register(`p07-b-${unique}@example.com`);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(userA.token)).send({ connectorId: connectorKey, externalAccountName: 'P0-7 side effect test' }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: ['TEST_R3_EXTERNAL', 'TEST_R3_LOOKUP', 'TEST_R3_UNSAFE', 'TEST_R4_EXTERNAL'].map((capability) => ({ capability, granted: true })) }).expect(200);
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function register(email: string): Promise<Session> {
    const result = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName: email.split('@')[0] }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(result.body.accessToken)).expect(200);
    return { token: result.body.accessToken, userId: me.body.id };
  }
  const action = (capability: 'TEST_R3_EXTERNAL' | 'TEST_R3_LOOKUP' | 'TEST_R3_UNSAFE' | 'TEST_R4_EXTERNAL', stepOrder = 0) => ({ actionType: 'update_internal_record', connectionId, requiredCapability: capability, config: { recordType: 'side_effect_test' }, stepOrder });
  const definition = (name: string, actions: Array<Record<string, unknown>>) => ({ name, description: 'P0-7 side effect integration', domain: 'general', automationLevel: 'L2', sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [], actions });
  async function createPlan(body: Record<string, unknown>) {
    const plan = (await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(body).expect(201)).body;
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/1/apply`).set(auth(userA.token)).expect(201);
    return (await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'active' }).expect(201)).body;
  }
  async function dispatch(planId: string, payload: Record<string, unknown> = {}) { return request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(userA.token)).send({ requestId: `p07-${unique}-${randomUUID()}`, triggerPayload: payload }).expect(201); }
  async function detail(id: string) { return (await request(app.getHttpServer()).get(`/api/executions/${id}`).set(auth(userA.token)).expect(200)).body; }
  async function runToWait(planId: string, payload: Record<string, unknown> = {}) {
    const created = await dispatch(planId, payload);
    expect((await worker.processExecution(created.body.id)).status).toBe('waiting_approval');
    const execution = await detail(created.body.id);
    const approval = (await request(app.getHttpServer()).get('/api/approvals?status=pending').set(auth(userA.token)).expect(200)).body.find((item: { executionId: string }) => item.executionId === created.body.id);
    return { executionId: created.body.id, stepId: execution.steps[0].id, requestId: execution.requestId, approval };
  }
  async function approveToDispatch(approvalId: string, executionId: string, confirmation?: string) {
    await request(app.getHttpServer()).post(`/api/approvals/${approvalId}/approve`).set(auth(userA.token)).send({ deviceId: 'p07-test', ...(confirmation ? { confirmation } : {}) }).expect(201);
    expect((await worker.processExecution(executionId)).status).toBe('waiting_dispatch');
  }
  async function forceRetryNow() { await pool.query("UPDATE outbox_messages SET next_attempt_at=? WHERE status='retry_wait'", [new Date(Date.now() - 1000)]); }
  // 把上一测试可能残留的 pending 消息全部消化到终态，再清零 Connector 计数，保证各用例绝对计数确定。
  async function drainAndReset() {
    for (let i = 0; i < 4; i += 1) { await outboxWorker.poll(); await forceRetryNow(); }
    connector.reset();
  }
  async function stepRow(stepId: string) {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(plan_action_id) planActionId FROM execution_steps WHERE id=UUID_TO_BIN(?)", [stepId]);
    return rows[0] as unknown as { planActionId: string };
  }
  async function opByStep(stepId: string): Promise<OperationRow | null> {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(execution_step_id) execution_step_id, BIN_TO_UUID(execution_id) execution_id, status, idempotency_key idempotencyKey, input_fingerprint inputFingerprint, provider_idempotency_key providerIdempotencyKey, attempt_count attemptCount, error_code errorCode, correlation_id correlationId, causation_id causationId FROM side_effect_operations WHERE execution_step_id=UUID_TO_BIN(?)", [stepId]);
    return (rows[0] as unknown as OperationRow) ?? null;
  }
  async function outboxByOp(opId: string): Promise<OutboxRow | null> {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(aggregate_id) aggregateId, status, dedupe_key dedupeKey, payload_hash payloadHash, payload_json payloadJson, attempt_count attemptCount, next_attempt_at nextAttemptAt, last_error_code lastErrorCode, correlation_id correlationId, causation_id causationId FROM outbox_messages WHERE aggregate_id=UUID_TO_BIN(?)", [opId]);
    return (rows[0] as unknown as OutboxRow) ?? null;
  }
  async function auditForExecution(executionId: string) {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id, actor_type actorType, action, BIN_TO_UUID(execution_id) executionId, BIN_TO_UUID(execution_step_id) executionStepId, BIN_TO_UUID(side_effect_operation_id) operationId, correlation_id correlationId, causation_id causationId, result, reason_code reasonCode, JSON_UNQUOTE(JSON_EXTRACT(COALESCE(before_snapshot_json,'{}'),'$')) beforeSnapshot, JSON_UNQUOTE(JSON_EXTRACT(COALESCE(after_snapshot_json,'{}'),'$')) afterSnapshot, change_summary changeSummary FROM audit_logs WHERE execution_id=UUID_TO_BIN(?) ORDER BY created_at", [executionId]);
    return rows as unknown as Array<{ id: string; actorType: string; action: string; executionId: string | null; executionStepId: string | null; operationId: string | null; correlationId: string | null; causationId: string | null; result: string; reasonCode: string | null; beforeSnapshot: unknown; afterSnapshot: unknown; changeSummary: string | null }>;
  }
  function sideEffects(capability: string) { return connector.sideEffects.get(capability) ?? 0; }
  function calls(capability: string) { return connector.calls.get(capability) ?? 0; }

  // ============ Audit 01-18 ============

  it('01/02/03 appends Audit, and rejects UPDATE and DELETE at the database', async () => {
    const plan = await createPlan(definition('Audit append', [{ actionType: 'compare', config: {}, stepOrder: 0 }]));
    const [createdRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='PLAN_CREATED'");
    expect(Number(createdRows[0].count)).toBeGreaterThanOrEqual(1);
    const [sample] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM audit_logs ORDER BY created_at DESC LIMIT 1");
    await expect(pool.query("UPDATE audit_logs SET change_summary='tampered' WHERE id=UUID_TO_BIN(?)", [sample[0].id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM audit_logs WHERE id=UUID_TO_BIN(?)", [sample[0].id])).rejects.toThrow(/append-only/);
    await request(app.getHttpServer()).post(`/api/executions/${(await dispatch(plan.id)).body.id}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('04/05/06/07 audits Plan Apply, Approval Decision, Temporary Authorization and Permission Change', async () => {
    const plan = await createPlan(definition('Audit domains', [{ actionType: 'compare', config: {}, stepOrder: 0 }]));
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/versions/1/apply`).set(auth(userA.token)).expect(201);
    const [applyRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='PLAN_VERSION_APPLIED' AND resource_id=?", [plan.id]);
    expect(Number(applyRows[0].count)).toBeGreaterThanOrEqual(1);
    await request(app.getHttpServer()).post('/api/temporary-authorizations').set(auth(userA.token)).send({ planVersionId: plan.activeVersionId, connectionId, capabilityKey: 'TEST_R3_EXTERNAL', maximumRiskLevel: 'R3', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }).expect(201);
    const [tempRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='TEMPORARY_AUTHORIZATION_CREATED'");
    expect(Number(tempRows[0].count)).toBeGreaterThanOrEqual(1);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R3_EXTERNAL', granted: false }] }).expect(200);
    const [permRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='PERMISSION_CHANGE'");
    expect(Number(permRows[0].count)).toBeGreaterThanOrEqual(1);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: ['TEST_R3_EXTERNAL', 'TEST_R3_LOOKUP', 'TEST_R3_UNSAFE', 'TEST_R4_EXTERNAL'].map((capability) => ({ capability, granted: true })) }).expect(200);
    const approvalPlan = await createPlan(definition('Audit approval', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(approvalPlan.id);
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'p07' }).expect(201);
    const [approvalRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='APPROVAL_APPROVED'");
    expect(Number(approvalRows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('08 audits Execution terminal state with the correct actor', async () => {
    const plan = await createPlan(definition('Audit terminal', [{ actionType: 'compare', config: {}, stepOrder: 0 }]));
    const created = await dispatch(plan.id);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const rows = await auditForExecution(created.body.id);
    const terminal = rows.find((row) => row.action === 'EXECUTION_TERMINAL');
    expect(terminal).toBeTruthy();
    expect(terminal!.actorType).toBe('user');
    expect(terminal!.result).toBe('success');
  });

  it('09/10/14/15/16 audits Side Effect prepare/succeed with outbox_worker actor, correlation and causation', async () => {
    const plan = await createPlan(definition('Audit side effect', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    expect(operation).toBeTruthy();
    await outboxWorker.poll();
    const rows = await auditForExecution(waiting.executionId);
    const prepared = rows.find((row) => row.action === 'SIDE_EFFECT_PREPARED');
    const succeeded = rows.find((row) => row.action === 'SIDE_EFFECT_SUCCEEDED');
    expect(prepared).toBeTruthy(); expect(succeeded).toBeTruthy();
    expect(succeeded!.actorType).toBe('outbox_worker');
    expect(prepared!.correlationId).toBe(waiting.requestId);
    expect(prepared!.causationId).toBe(waiting.stepId);
    expect(prepared!.operationId).toBe(operation!.id);
    expect(succeeded!.causationId).toBe(operation!.id);
    expect(succeeded!.result).toBe('success');
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
  });

  it('11 audits Side Effect failure when the Provider rejects', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'reject');
    const plan = await createPlan(definition('Audit failure', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    const rows = await auditForExecution(waiting.executionId);
    const failed = rows.find((row) => row.action === 'SIDE_EFFECT_FAILED');
    expect(failed).toBeTruthy();
    expect(failed!.result).toBe('failure');
    expect((await opByStep(waiting.stepId))!.status).toBe('failed');
    expect((await detail(waiting.executionId)).status).toBe('failed');
    connector.setMode('TEST_R3_EXTERNAL', 'ok');
  });

  it('12 audits outcome_unknown and stops automatic retry', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_LOOKUP', 'timeout-always');
    const plan = await createPlan(definition('Audit outcome unknown', [action('TEST_R3_LOOKUP')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    for (let i = 0; i < 6; i += 1) { await outboxWorker.poll(); await forceRetryNow(); }
    const rows = await auditForExecution(waiting.executionId);
    const unknown = rows.find((row) => row.action === 'SIDE_EFFECT_OUTCOME_UNKNOWN');
    expect(unknown).toBeTruthy();
    expect((await opByStep(waiting.stepId))!.status).toBe('outcome_unknown');
    connector.setMode('TEST_R3_LOOKUP', 'ok');
  });

  it('13 audits Idempotency Key Conflict when the same key arrives with a different payload', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Audit conflict', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const { planActionId } = await stepRow(waiting.stepId);
    // 通过 Coordinator 以“同一步骤、不同 input fingerprint”再次 prepare：必须拒绝并留下审计。
    const coordinator = app.get('SIDE_EFFECT_COORDINATOR') as { prepare(input: Record<string, unknown>): Promise<unknown> };
    await expect(coordinator.prepare({
      execution: { id: waiting.executionId, userId: userA.userId, planId: plan.id, planVersionId: plan.activeVersionId, requestId: waiting.requestId, triggerPayloadJson: {} },
      step: { id: waiting.stepId, planActionId, stepOrder: 0, actionType: 'update_internal_record', connectionId, requiredCapability: 'TEST_R3_EXTERNAL', inputFingerprint: 'f'.repeat(64) },
      action: { actionType: 'update_internal_record', connectionId, requiredCapability: 'TEST_R3_EXTERNAL', config: { recordType: 'side_effect_test' }, stepOrder: 0 },
      effectiveRisk: 'R3',
    })).rejects.toThrow(/cannot be reused/i);
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    const [conflictRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action='SIDE_EFFECT_IDEMPOTENCY_CONFLICT' AND execution_id=UUID_TO_BIN(?)", [waiting.executionId]);
    expect(Number(conflictRows[0].count)).toBe(1);
    expect((await opByStep(waiting.stepId))!.id).toBe(operation!.id);
    await outboxWorker.poll();
  });

  it('17 sanitizes secrets out of every Audit snapshot and 18 never fabricates legacy history', async () => {
    const secret = `p07-secret-${unique}`;
    const plan = await createPlan(definition('Audit sanitizer', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id, { token: secret, password: `${secret}-pw` });
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    const rows = await auditForExecution(waiting.executionId);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(`${secret}-pw`);
    // 18：Audit 是系统启用后的记录，不为历史 ExecutionEvent 伪造，测试环境也不写系统锚点。
    const [backfill] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action IN ('AUDIT_SYSTEM_ENABLED','EXECUTION_EVENT_BACKFILL','AUDIT_BACKFILL')");
    expect(Number(backfill[0].count)).toBe(0);
    const legacy = randomUUID();
    const [planRow] = await pool.query<RowDataPacket[]>("SELECT id,user_id FROM plans WHERE user_id=UUID_TO_BIN(?) LIMIT 1", [userA.userId]);
    const [versionRow] = await pool.query<RowDataPacket[]>("SELECT id FROM plan_versions WHERE plan_id=? ORDER BY version_number DESC LIMIT 1", [planRow[0].id]);
    await pool.query("INSERT INTO executions (id,user_id,plan_id,plan_version_id,definition_hash,request_id,trigger_type,trigger_payload_json,status,declared_risk_level,approval_status,execution_policy_version,resolved_retry_policy_json,resolved_fallback_policy_json,created_at,updated_at) VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,'legacy-hash','legacy-request','manual',JSON_OBJECT(),'succeeded','R0','not_requested','p0-5','{}','{}',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [legacy, userA.userId, planRow[0].id, versionRow[0].id]);
    const [legacyAudit] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE execution_id=UUID_TO_BIN(?)", [legacy]);
    expect(Number(legacyAudit[0].count)).toBe(0);
  });

  // ============ Idempotency 19-31 ============

  it('19 returns the existing Operation for same key + same payload and never duplicates the side effect', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Idempotency same payload', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const { planActionId } = await stepRow(waiting.stepId);
    const base = {
      userId: userA.userId, executionId: waiting.executionId, executionStepId: waiting.stepId,
      planId: plan.id, planVersionId: plan.activeVersionId, planActionId, actionType: 'update_internal_record',
      connectorId: null, connectionId, capabilityKey: 'TEST_R3_EXTERNAL', inputFingerprint: operation!.inputFingerprint,
      requestSnapshot: {}, correlationId: waiting.requestId, causationId: waiting.stepId, providerIdempotencyKey: null, requestId: `${waiting.executionId}:0`,
    };
    const again = await ops.prepare(base);
    expect(again.conflict).toBe(false);
    expect(again.id).toBe(operation!.id);
    await outboxWorker.poll();
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(1);
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
  });

  it('20 rejects same key + different payload with IDEMPOTENCY_KEY_CONFLICT and performs zero extra calls', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Idempotency conflict', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const { planActionId } = await stepRow(waiting.stepId);
    const base = {
      userId: userA.userId, executionId: waiting.executionId, executionStepId: waiting.stepId,
      planId: plan.id, planVersionId: plan.activeVersionId, planActionId, actionType: 'update_internal_record',
      connectorId: null, connectionId, capabilityKey: 'TEST_R3_EXTERNAL', inputFingerprint: 'e'.repeat(64),
      requestSnapshot: {}, correlationId: waiting.requestId, causationId: waiting.stepId, providerIdempotencyKey: null, requestId: `${waiting.executionId}:0`,
    };
    await expect(ops.prepare(base)).rejects.toThrow(/cannot be reused/i);
    // 冲突发生在任何外部调用之前：绝不产生第二个业务动作。
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    await outboxWorker.poll();
    // 原始 Operation 仍只执行一次。
    expect(calls('TEST_R3_EXTERNAL')).toBe(1);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
  });

  it('21 retries with the exact same idempotency key and produces one side effect', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'rate-limit-once');
    const plan = await createPlan(definition('Idempotency retry', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll(); await forceRetryNow(); await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('succeeded');
    const keys = connector.receivedKeys.get('TEST_R3_EXTERNAL') ?? [];
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(operation!.idempotencyKey);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(2);
  });

  it('22 recovers from a crash after provider success with the same key and no second side effect', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Crash after send', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    // 模拟：Provider 已成功收到请求并产生副作用，但 Worker 在写 DB 前崩溃。
    const first = await connector.execute({ capability: 'TEST_R3_EXTERNAL', input: {}, requestId: `${waiting.executionId}:0`, idempotencyKey: operation!.idempotencyKey });
    expect(first.ok).toBe(true);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    // 恢复：Outbox 重新投递，同 key → Provider 幂等去重，不产生第二个副作用。
    await outboxWorker.poll();
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(2);
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
  });

  it('23 duplicate Worker runs are safe after success', async () => {
    const plan = await createPlan(definition('Duplicate worker', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    await outboxWorker.poll();
    expect((await worker.processExecution(waiting.executionId)).status).toBe('succeeded');
    const [opCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)", [waiting.executionId]);
    expect(Number(opCount[0].count)).toBe(1);
  });

  it('24 duplicate Outbox enqueue with the same dedupe key yields a single row', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Outbox dedupe', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const input = { aggregateType: 'side_effect_operation', aggregateId: operation!.id, userId: userA.userId, eventType: 'side_effect.dispatch', destination: 'connector.execute', payload: { operationId: operation!.id }, dedupeKey: `side-effect:${operation!.id}`, correlationId: waiting.requestId, causationId: operation!.id };
    await outbox.enqueue(input);
    await outbox.enqueue(input);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM outbox_messages WHERE dedupe_key=?", [`side-effect:${operation!.id}`]);
    expect(Number(rows[0].count)).toBe(1);
    await outboxWorker.poll();
  });

  it('25/35 two concurrent Workers can only claim one message', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Concurrent claim', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const results = await Promise.all([outbox.claim(8, 'worker-a', 30_000), outbox.claim(8, 'worker-b', 30_000)]);
    const winners = results.flat().filter((row) => row.dedupeKey === `side-effect:${operation!.id}`);
    expect(winners).toHaveLength(1);
    await outboxWorker.poll();
  });

  it('26 a succeeded Operation is never re-invoked on redelivery', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('No replay succeeded', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await outboxWorker.poll();
    const before = sideEffects('TEST_R3_EXTERNAL');
    const message = await outbox.get((await outboxByOp(operation!.id))!.id);
    await outboxWorker.process(message);
    await outboxWorker.process(message);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(before);
  });

  it('27 a known-safe retryable failure recovers correctly with the same key', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'rate-limit-once');
    const plan = await createPlan(definition('Safe retry', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    let row = await outboxByOp((await opByStep(waiting.stepId))!.id);
    expect(row!.status).toBe('retry_wait');
    await forceRetryNow(); await outboxWorker.poll();
    row = await outboxByOp((await opByStep(waiting.stepId))!.id);
    expect(row!.status).toBe('published');
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
  });

  it('28/68 an ambiguous timeout stops with outcome_unknown and never retries beyond the policy', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_LOOKUP', 'timeout-always');
    const plan = await createPlan(definition('Ambiguous outcome', [action('TEST_R3_LOOKUP')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    for (let i = 0; i < 7; i += 1) { await outboxWorker.poll(); await forceRetryNow(); }
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('outcome_unknown');
    expect(calls('TEST_R3_LOOKUP')).toBe(5);
    const [p0] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM notifications WHERE execution_id=UUID_TO_BIN(?) AND event_type='side_effect_outcome_unknown'", [waiting.executionId]);
    expect(Number(p0[0].count)).toBe(1);
    const final = await detail(waiting.executionId);
    expect(final.status).toBe('failed');
    expect(final.steps[0].dispatchStatus).toBe('outcome_unknown');
  });

  it('29/30 idempotency key and input fingerprint are immutable at the database', async () => {
    const plan = await createPlan(definition('Key immutable', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await expect(pool.query("UPDATE side_effect_operations SET idempotency_key=REPEAT('a',64) WHERE id=UUID_TO_BIN(?)", [operation!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE side_effect_operations SET input_fingerprint=REPEAT('b',64) WHERE id=UUID_TO_BIN(?)", [operation!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE side_effect_operations SET user_id=UUID_TO_BIN('00000000-0000-0000-0000-000000000000') WHERE id=UUID_TO_BIN(?)", [operation!.id])).rejects.toThrow(/immutable/);
    await outboxWorker.poll();
  });

  it('31 keeps idempotency scoped per user and isolated across users', async () => {
    const plan = await createPlan(definition('Cross user isolation', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    const shared = { executionId: waiting.executionId, executionStepId: waiting.stepId, planId: plan.id, planVersionId: plan.activeVersionId, planActionId: waiting.stepId, actionType: 'update_internal_record', connectionId, capabilityKey: 'TEST_R3_EXTERNAL', inputFingerprint: 'c'.repeat(64) };
    const keyA = ops.keyFor({ userId: userA.userId, ...shared });
    const keyB = ops.keyFor({ userId: userB.userId, ...shared });
    expect(keyA).not.toBe(keyB);
    await request(app.getHttpServer()).get(`/api/executions/${waiting.executionId}`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/approvals/${waiting.approval.id}`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.executionId}/cancel`).set(auth(userA.token)).expect(201);
  });

  // ============ Outbox 32-46 ============

  it('32/34 writes Operation and Outbox in one transaction and polls discover pending messages', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Outbox atomic', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const message = await outboxByOp(operation!.id);
    expect(operation).toBeTruthy(); expect(message).toBeTruthy();
    expect(message!.status).toBe('pending');
    const claimed = await outbox.claim(8, 'discovery-worker');
    expect(claimed.some((row) => row.id === message!.id)).toBe(true);
    await outboxWorker.poll();
  });

  it('33/59 a failed transaction rolls back both Operation and Outbox and leaves no dispatch state', async () => {
    const plan = await createPlan(definition('Rollback', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    const { planActionId } = await stepRow(waiting.stepId);
    const idempotencyKey = ops.keyFor({ userId: userA.userId, executionId: waiting.executionId, executionStepId: waiting.stepId, planId: plan.id, planVersionId: plan.activeVersionId, planActionId, actionType: 'update_internal_record', connectionId, capabilityKey: 'TEST_R3_EXTERNAL' });
    const rollbackId = randomUUID();
    // 单连接事务：Operation + Outbox 同事务写入，随后回滚必须同时消失（等价于 §19 同事务语义）。
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("INSERT INTO side_effect_operations (id,user_id,execution_id,execution_step_id,plan_id,plan_version_id,plan_action_id,action_type,idempotency_key,input_fingerprint,request_snapshot_json,status,correlation_id,causation_id,created_at,updated_at) VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'update_internal_record',?,REPEAT('d',64),JSON_OBJECT(),'prepared',?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [rollbackId, userA.userId, waiting.executionId, waiting.stepId, plan.id, plan.activeVersionId, planActionId, idempotencyKey, waiting.requestId, waiting.stepId]);
      await conn.query("INSERT INTO outbox_messages (id,aggregate_type,aggregate_id,user_id,event_type,destination,payload_json,payload_hash,dedupe_key,correlation_id,causation_id,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),'side_effect_operation',UUID_TO_BIN(?),UUID_TO_BIN(?),'side_effect.dispatch','connector.execute',JSON_OBJECT('operationId',?),REPEAT('0',64),?,?,?, 'pending',0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [rollbackId, userA.userId, rollbackId, `side-effect:${rollbackId}`, waiting.requestId, rollbackId]);
      await conn.rollback();
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
    const [opCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations WHERE id=UUID_TO_BIN(?)", [rollbackId]);
    const [outboxCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM outbox_messages WHERE aggregate_id=UUID_TO_BIN(?)", [rollbackId]);
    expect(Number(opCount[0].count)).toBe(0);
    expect(Number(outboxCount[0].count)).toBe(0);
    expect((await detail(waiting.executionId)).status).toBe('waiting_approval');
    await request(app.getHttpServer()).post(`/api/executions/${waiting.executionId}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('36/64 a lease that expires lets another Worker reclaim and process the message', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Lease expiry', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const claimed = await outbox.claim(8, 'worker-crash', 30_000);
    const message = claimed.find((row) => row.dedupeKey === `side-effect:${operation!.id}`);
    expect(message).toBeTruthy();
    expect((await outbox.claim(8, 'worker-b')).some((row) => row.dedupeKey === `side-effect:${operation!.id}`)).toBe(false);
    // 锁过期 → 另一个 Worker 可以重新 Claim。
    await pool.query("UPDATE outbox_messages SET lock_expires_at=? WHERE id=UUID_TO_BIN(?)", [new Date(Date.now() - 60_000), message!.id]);
    const recovered = await outbox.claim(8, 'worker-recovered');
    const recoveredRow = recovered.find((row) => row.id === message!.id);
    expect(recoveredRow).toBeTruthy();
    // 直接交给已 claim 的 Worker 完成处理。
    await outboxWorker.process(recoveredRow);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
  });

  it('37 duplicate delivery after success is safe and idempotent', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Duplicate delivery', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await outboxWorker.poll();
    const before = sideEffects('TEST_R3_EXTERNAL');
    for (let i = 0; i < 4; i += 1) {
      const message = await outbox.get((await outboxByOp(operation!.id))!.id);
      await outboxWorker.process(message);
    }
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(before);
  });

  it('38/39 retry_wait schedules an exponential backoff', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'timeout-twice');
    const plan = await createPlan(definition('Backoff', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await outboxWorker.poll();
    let row = await outboxByOp(operation!.id);
    expect(row!.status).toBe('retry_wait');
    expect(row!.attemptCount).toBe(1);
    const firstDelay = new Date(row!.nextAttemptAt).getTime() - Date.now();
    await forceRetryNow(); await outboxWorker.poll();
    row = await outboxByOp(operation!.id);
    expect(row!.status).toBe('retry_wait');
    expect(row!.attemptCount).toBe(2);
    const secondDelay = new Date(row!.nextAttemptAt).getTime() - Date.now();
    expect(secondDelay).toBeGreaterThan(firstDelay);
    await forceRetryNow(); await outboxWorker.poll();
  });

  it('40/41/66 max attempts dead-letter with a P1 notification and no infinite retry', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'http500');
    const plan = await createPlan(definition('Dead letter', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    for (let i = 0; i < 7; i += 1) { await outboxWorker.poll(); await forceRetryNow(); }
    const operation = await opByStep(waiting.stepId);
    const row = await outboxByOp(operation!.id);
    expect(row!.status).toBe('dead');
    expect(row!.lastErrorCode).toBe('PROVIDER_5XX');
    expect(calls('TEST_R3_EXTERNAL')).toBe(5);
    expect(operation!.status).toBe('failed');
    const [deadNotices] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM notifications WHERE execution_id=UUID_TO_BIN(?) AND event_type='side_effect_dead_letter'", [waiting.executionId]);
    expect(Number(deadNotices[0].count)).toBe(1);
    expect((await detail(waiting.executionId)).status).toBe('failed');
  });

  it('42/43/44 stores a payload hash, blocks tampered payloads and never persists secrets', async () => {
    await drainAndReset();
    const secret = `outbox-secret-${unique}`;
    const plan = await createPlan(definition('Payload integrity', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id, { token: secret });
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const row = await outboxByOp(operation!.id);
    // 42：payload_hash 与内容一致。
    expect(row!.payloadHash).toBe(hashPayload(row!.payloadJson));
    // 44：Outbox payload 不含任何秘密。
    expect(JSON.stringify(row!.payloadJson)).not.toContain(secret);
    // 43：模拟被篡改的 Outbox 行（payload_hash 与内容不符，绕过业务写入路径）。
    await pool.query("UPDATE outbox_messages SET status='processing', locked_by='tamper-hold', lock_expires_at=? WHERE id=UUID_TO_BIN(?)", [new Date(Date.now() + 3600_000), row!.id]);
    await pool.query("INSERT INTO outbox_messages (id,aggregate_type,aggregate_id,user_id,event_type,destination,payload_json,payload_hash,dedupe_key,correlation_id,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),'side_effect_operation',UUID_TO_BIN(?),UUID_TO_BIN(?),'side_effect.dispatch','connector.execute',JSON_OBJECT('operationId','00000000-0000-0000-0000-000000000000'),REPEAT('0',64),?,'tampered','pending',0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [operation!.id, userA.userId, `side-effect-tampered:${operation!.id}`]);
    await outboxWorker.poll();
    const [tampered] = await pool.query<RowDataPacket[]>("SELECT status, last_error_code lastErrorCode FROM outbox_messages WHERE dedupe_key=?", [`side-effect-tampered:${operation!.id}`]);
    expect(tampered[0].status).toBe('dead');
    expect(tampered[0].lastErrorCode).toBe('SECURITY_PAYLOAD_INTEGRITY_FAILURE');
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    // 45 补充：payload_json 直接改写被 identity 触发器拒绝（防篡改的纵深防御）。
    await expect(pool.query("UPDATE outbox_messages SET payload_json=JSON_OBJECT('x',1) WHERE id=UUID_TO_BIN(?)", [row!.id])).rejects.toThrow(/immutable/);
  });

  it('45/46 published messages are immutable and Outbox/SideEffect/Audit history cannot be deleted', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Outbox immutable', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await outboxWorker.poll();
    const row = await outboxByOp(operation!.id);
    expect(row!.status).toBe('published');
    await expect(pool.query("UPDATE outbox_messages SET status='pending' WHERE id=UUID_TO_BIN(?)", [row!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE outbox_messages SET payload_hash=REPEAT('0',64) WHERE id=UUID_TO_BIN(?)", [row!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM outbox_messages WHERE id=UUID_TO_BIN(?)", [row!.id])).rejects.toThrow(/deleted/);
    await expect(pool.query("DELETE FROM side_effect_operations WHERE id=UUID_TO_BIN(?)", [operation!.id])).rejects.toThrow(/deleted/);
  });

  // ============ Side Effect 47-58 ============

  it('47 R0 actions never enter the external Outbox pipeline', async () => {
    const plan = await createPlan(definition('R0 internal', [{ actionType: 'compare', config: {}, stepOrder: 0 }]));
    const created = await dispatch(plan.id);
    expect((await worker.processExecution(created.body.id)).status).toBe('succeeded');
    const [opCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)", [created.body.id]);
    expect(Number(opCount[0].count)).toBe(0);
  });

  it('48 an unapproved R3 side effect stays waiting_approval with no dispatch', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('R3 unapproved', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    const [opCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)", [waiting.executionId]);
    expect(Number(opCount[0].count)).toBe(0);
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.executionId}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('49/50 an approved R3 action with platform idempotency is dispatched exactly once through the Outbox', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('R3 allowed', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    // Provider 支持官方幂等键：Operation 保存了 provider_idempotency_key。
    expect(operation!.providerIdempotencyKey).toBeTruthy();
    expect(operation!.providerIdempotencyKey!.length).toBeLessThanOrEqual(128);
    await outboxWorker.poll();
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(1);
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
  });

  it('51 R4 without strong confirmation is blocked before dispatch', async () => {
    const plan = await createPlan(definition('R4 no strong', [action('TEST_R4_EXTERNAL')]));
    const waiting = await runToWait(plan.id, { amount: 100 });
    await request(app.getHttpServer()).post(`/api/approvals/${waiting.approval.id}/approve`).set(auth(userA.token)).send({ deviceId: 'p07' }).expect(400);
    const [opCount] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)", [waiting.executionId]);
    expect(Number(opCount[0].count)).toBe(0);
    expect(calls('TEST_R4_EXTERNAL')).toBe(0);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.executionId}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('52 R4 with strong confirmation runs the mock side effect once through the safe foundation path', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('R4 strong path', [action('TEST_R4_EXTERNAL')]));
    const waiting = await runToWait(plan.id, { amount: 100 });
    await approveToDispatch(waiting.approval.id, waiting.executionId, 'APPROVE_R4');
    const operation = await opByStep(waiting.stepId);
    await outboxWorker.poll();
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
    expect(sideEffects('TEST_R4_EXTERNAL')).toBe(1);
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
    void operation;
  });

  it('53 a revoked Permission after Approval blocks dispatch and never calls the connector', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Permission after approve', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: [{ capability: 'TEST_R3_EXTERNAL', granted: false }] }).expect(200);
    await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('failed');
    expect(operation!.errorCode).toBe('PERMISSION_REVOKED');
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    expect((await detail(waiting.executionId)).status).toBe('failed');
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: ['TEST_R3_EXTERNAL', 'TEST_R3_LOOKUP', 'TEST_R3_UNSAFE', 'TEST_R4_EXTERNAL'].map((capability) => ({ capability, granted: true })) }).expect(200);
  });

  it('54 a revoked Connection after Approval blocks dispatch', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Connection after approve', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(userA.token)).expect(204);
    await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('failed');
    expect(operation!.errorCode).toBe('CONNECTION_REVOKED');
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    // 恢复连接：revoke 会连带撤销全部权限，需一并恢复。
    await pool.query("UPDATE connections SET status='connected' WHERE id=UUID_TO_BIN(?)", [connectionId]);
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(userA.token)).send({ permissions: ['TEST_R3_EXTERNAL', 'TEST_R3_LOOKUP', 'TEST_R3_UNSAFE', 'TEST_R4_EXTERNAL'].map((capability) => ({ capability, granted: true })) }).expect(200);
  });

  it('55 an expired Credential after Approval blocks dispatch', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Credential after approve', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await pool.query("INSERT INTO credential_refs (id,credential_ref,provider,status,expires_at,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),?, 'test','active',DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [`p07-expired-${unique}-${randomUUID()}`]);
    await pool.query("UPDATE connections SET credential_ref_id=(SELECT id FROM credential_refs ORDER BY created_at DESC LIMIT 1) WHERE id=UUID_TO_BIN(?)", [connectionId]);
    await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('failed');
    expect(operation!.errorCode).toBe('CREDENTIAL_EXPIRED');
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    await pool.query("UPDATE connections SET credential_ref_id=NULL WHERE id=UUID_TO_BIN(?)", [connectionId]);
  });

  it('56 a paused Plan after Approval blocks external dispatch', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Plan paused after approve', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await request(app.getHttpServer()).post(`/api/plans/${plan.id}/status`).set(auth(userA.token)).send({ status: 'paused' }).expect(201);
    await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    expect(operation!.status).toBe('failed');
    expect(operation!.errorCode).toBe('PLAN_NOT_ACTIVE');
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
  });

  it('57 risk snapshots cannot be altered after the fact', async () => {
    const plan = await createPlan(definition('Risk altered', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await expect(pool.query("UPDATE execution_steps SET effective_risk_level='R0' WHERE id=UUID_TO_BIN(?)", [waiting.stepId])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE execution_steps SET risk_snapshot_json=JSON_OBJECT('tampered',1) WHERE id=UUID_TO_BIN(?)", [waiting.stepId])).rejects.toThrow(/immutable/);
    await request(app.getHttpServer()).post(`/api/executions/${waiting.executionId}/cancel`).set(auth(userA.token)).expect(201);
  });

  it('58 a connector that declares no retry safety is handled most conservatively', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_UNSAFE', 'timeout-always');
    const plan = await createPlan(definition('Unsafe contract', [action('TEST_R3_UNSAFE')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    const operation = await opByStep(waiting.stepId);
    // retrySafety=unsafe：第一次模糊失败即 outcome_unknown，绝不自动重试。
    expect(operation!.status).toBe('outcome_unknown');
    expect(calls('TEST_R3_UNSAFE')).toBe(1);
  });

  // ============ Crash Fault Injection 60-63, 65, 67 ============

  it('60 an Outbox committed without any publish is recovered by the poller and delivered once', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Outbox no publish', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const row = await outboxByOp(operation!.id);
    // 模拟 "BullMQ publish 从未发生"：只有 DB 里的 pending Outbox 行。
    expect(row!.status).toBe('pending');
    expect((await detail(waiting.executionId)).status).toBe('waiting_dispatch');
    await outboxWorker.poll();
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect((await outboxByOp(operation!.id))!.status).toBe('published');
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
  });

  it('61 a crash before the connector call is recovered after the lease expires', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Crash before connector', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await outbox.claim(8, 'worker-crash', 30_000);
    await outboxWorker.poll();
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
    await pool.query("UPDATE outbox_messages SET lock_expires_at=? WHERE aggregate_id=UUID_TO_BIN(?)", [new Date(Date.now() - 60_000), operation!.id]);
    await outboxWorker.poll();
    expect(calls('TEST_R3_EXTERNAL')).toBe(1);
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
  });

  it('62 a crash after provider success is recovered with the same key and one side effect', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Crash after success', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    await connector.execute({ capability: 'TEST_R3_EXTERNAL', input: {}, requestId: `${waiting.executionId}:0`, idempotencyKey: operation!.idempotencyKey });
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    await outboxWorker.poll();
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(2);
    const keys = connector.receivedKeys.get('TEST_R3_EXTERNAL') ?? [];
    expect(keys[0]).toBe(keys[1]);
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
  });

  it('63 a crash after DB success is finalized on redelivery without any duplicate side effect', async () => {
    await drainAndReset();
    const plan = await createPlan(definition('Crash after DB success', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    const operation = await opByStep(waiting.stepId);
    const message = await outboxByOp(operation!.id);
    // 模拟 succeedOperation 已提交 DB，但 Execution finalize 尚未发生（Worker 崩溃）。
    await pool.query("UPDATE side_effect_operations SET status='succeeded' WHERE id=UUID_TO_BIN(?)", [operation!.id]);
    await pool.query("UPDATE execution_steps SET status='succeeded', dispatch_status='succeeded' WHERE id=UUID_TO_BIN(?)", [waiting.stepId]);
    await pool.query("UPDATE outbox_messages SET status='published', published_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [message!.id]);
    expect((await detail(waiting.executionId)).status).toBe('waiting_dispatch');
    await outboxWorker.process(await outbox.get(message!.id));
    expect((await detail(waiting.executionId)).status).toBe('succeeded');
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(0);
    expect(calls('TEST_R3_EXTERNAL')).toBe(0);
  });

  it('65 a provider timeout is retried and then succeeds exactly once', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'timeout-once');
    const plan = await createPlan(definition('Provider timeout retry', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    expect((await opByStep(waiting.stepId))!.status).toBe('retry_wait');
    await forceRetryNow(); await outboxWorker.poll();
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
    expect(calls('TEST_R3_EXTERNAL')).toBe(2);
  });

  it('67 a provider rate-limit is honored with backoff and the operation succeeds', async () => {
    await drainAndReset();
    connector.setMode('TEST_R3_EXTERNAL', 'rate-limit-once');
    const plan = await createPlan(definition('Rate limit retry', [action('TEST_R3_EXTERNAL')]));
    const waiting = await runToWait(plan.id);
    await approveToDispatch(waiting.approval.id, waiting.executionId);
    await outboxWorker.poll();
    expect((await opByStep(waiting.stepId))!.status).toBe('retry_wait');
    await forceRetryNow(); await outboxWorker.poll();
    expect((await opByStep(waiting.stepId))!.status).toBe('succeeded');
    expect(sideEffects('TEST_R3_EXTERNAL')).toBe(1);
  });
});
