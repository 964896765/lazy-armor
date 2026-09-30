import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

interface TodoRow {
  id: string;
  type: string;
  sourceId: string;
  summary: string;
  priority: string;
  status: string;
  createdAt: string;
  planId: string | null;
  planName: string | null;
  executionId: string | null;
  approvalRequestId: string | null;
  reconciliationCaseId: string | null;
  connectionId: string | null;
}

interface ExecutionRefs { executionId: string; planId: string; planVersionId: string; stepId: string; planActionId: string }

const hex = (length: number, seed: string) => seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

describe.sequential('GET /todos unified todo center', { timeout: 90_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let outsider: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`todos-${unique}`);
    app = booted.app;
    pool = booted.pool;
    owner = await register(app, `todos-${unique}@example.com`, 'Todos 用户');
    outsider = await register(app, `todos-out-${unique}@example.com`, 'Todos 外部用户');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  async function seedPlan(): Promise<string> {
    const plan = await request(app.getHttpServer())
      .post('/api/plans')
      .set(auth(owner.token))
      .send({
        name: `待办聚合 ${unique}`,
        domain: 'general',
        automationLevel: 'L1',
        sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
        triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
        conditions: [],
        actions: [{ actionType: 'record', config: { recordType: 'demo' }, stepOrder: 0 }],
      })
      .expect(201);
    const planId = plan.body.id as string;
    await activatePlan(app, owner.token, planId);
    return planId;
  }

  async function seedExecution(planId: string): Promise<ExecutionRefs> {
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(owner.token))
      .send({ requestId: `todos-${unique}-${randomUUID()}`, triggerPayload: {} })
      .expect(201);
    const executionId = created.body.id as string;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT BIN_TO_UUID(e.id) executionId, BIN_TO_UUID(e.plan_id) planId, BIN_TO_UUID(e.plan_version_id) planVersionId,
              BIN_TO_UUID(s.id) stepId, BIN_TO_UUID(s.plan_action_id) planActionId
         FROM executions e JOIN execution_steps s ON s.execution_id = e.id WHERE e.id = UUID_TO_BIN(?)`,
      [executionId],
    );
    return rows[0] as unknown as ExecutionRefs;
  }

  async function seedApproval(refs: ExecutionRefs, status: 'pending' | 'expired'): Promise<string> {
    const id = randomUUID();
    const expiresAt = status === 'pending' ? 'DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR)' : 'DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 HOUR)';
    await pool.query(
      `INSERT INTO approval_requests
        (id, user_id, execution_id, execution_step_id, plan_id, plan_version_id, plan_action_id,
         input_fingerprint, context_hash, effective_risk_level, action_summary, status, expires_at,
         decided_at, decision, decision_reason, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?),
         ?, ?, ?, ?, ?, ${expiresAt}, ${status === 'expired' ? 'UTC_TIMESTAMP(6)' : 'NULL'}, ${status === 'expired' ? "'expired'" : 'NULL'}, ${status === 'expired' ? "'审批已过期'" : 'NULL'}, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [id, owner.userId, refs.executionId, refs.stepId, refs.planId, refs.planVersionId, refs.planActionId,
        hex(64, 'a'), hex(64, 'b'), 'R3', '扣款 ¥200', status],
    );
    return id;
  }

  async function seedReconciliation(refs: ExecutionRefs, resolved: boolean): Promise<string> {
    const caseId = randomUUID();
    const operationId = randomUUID();
    const policyId = randomUUID();
    const policyHash = hex(64, 'c');
    const idempotencyKey = hex(64, operationId.replace(/-/g, ''));
    await pool.query(
      `INSERT INTO verification_policies (id, policy_key, revision, definition_json, definition_hash, created_at)
       VALUES (UUID_TO_BIN(?), ?, '1', JSON_OBJECT('key', 'test', 'methods', JSON_ARRAY('OPERATION_LOOKUP')), ?, UTC_TIMESTAMP(6))`,
      [policyId, `test-policy-${unique}-${randomUUID()}`, policyHash],
    );
    await pool.query(
      `INSERT INTO side_effect_operations
        (id, user_id, execution_id, execution_step_id, plan_id, plan_version_id, plan_action_id,
         action_type, idempotency_key, input_fingerprint, request_snapshot_json, status, correlation_id, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?),
         'record', ?, ?, JSON_OBJECT(), 'outcome_unknown', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [operationId, owner.userId, refs.executionId, refs.stepId, refs.planId, refs.planVersionId, refs.planActionId,
        idempotencyKey, hex(64, 'd'), refs.executionId],
    );
    await pool.query(
      `INSERT INTO reconciliation_cases
        (id, user_id, execution_id, execution_step_id, operation_id, policy_id,
         policy_snapshot_json, policy_hash, status, result_state, attempt_count, next_attempt_at, expires_at,
         resolved_at, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?),
         JSON_OBJECT('methods', JSON_ARRAY('OPERATION_LOOKUP')), ?, ?, ?, 0, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR),
         ${resolved ? 'UTC_TIMESTAMP(6)' : 'NULL'}, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [caseId, owner.userId, refs.executionId, refs.stepId, operationId, policyId,
        policyHash, resolved ? 'RESOLVED' : 'OPEN', resolved ? 'SUCCEEDED' : 'OUTCOME_UNKNOWN'],
    );
    return caseId;
  }

  it('aggregates the four types with OPEN/COMPLETED, expired approvals and result-unknown verification', async () => {
    const planId = await seedPlan();
    const confirmExec = await seedExecution(planId);
    const failedExec = await seedExecution(planId);
    const doneExec = await seedExecution(planId);
    const verifyOpenExec = await seedExecution(planId);
    const verifyResolvedExec = await seedExecution(planId);

    await pool.query(`UPDATE executions SET status='waiting_approval', approval_status='pending' WHERE id=UUID_TO_BIN(?)`, [confirmExec.executionId]);
    await pool.query(`UPDATE executions SET status='failed' WHERE id=UUID_TO_BIN(?)`, [failedExec.executionId]);
    await pool.query(`UPDATE executions SET status='succeeded', result_summary='已记录' WHERE id=UUID_TO_BIN(?)`, [doneExec.executionId]);

    const pendingApprovalId = await seedApproval(confirmExec, 'pending');
    const expiredApprovalId = await seedApproval(doneExec, 'expired');
    const openCaseId = await seedReconciliation(verifyOpenExec, false);
    const resolvedCaseId = await seedReconciliation(verifyResolvedExec, true);

    const response = await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200);
    const todos = response.body as TodoRow[];
    const byId = new Map(todos.map((item) => [item.id, item]));

    // 四类聚合
    expect(todos.map((item) => item.type)).toEqual(expect.arrayContaining(['APPROVAL', 'CONFIRMATION', 'EXCEPTION', 'VERIFICATION']));

    // APPROVAL：待审批 OPEN + 过期 COMPLETED
    const pending = byId.get(`approval:${pendingApprovalId}`);
    expect(pending).toMatchObject({ type: 'APPROVAL', status: 'OPEN', approvalRequestId: pendingApprovalId });
    const expired = byId.get(`approval:${expiredApprovalId}`);
    expect(expired).toMatchObject({ type: 'APPROVAL', status: 'COMPLETED', approvalRequestId: expiredApprovalId });

    // CONFIRMATION：待确认执行 OPEN + 成功执行 COMPLETED
    expect(byId.get(`execution:${confirmExec.executionId}`)).toMatchObject({ type: 'CONFIRMATION', status: 'OPEN', executionId: confirmExec.executionId });
    expect(byId.get(`execution:${doneExec.executionId}`)).toMatchObject({ type: 'CONFIRMATION', status: 'COMPLETED', executionId: doneExec.executionId });

    // EXCEPTION：失败执行 OPEN
    expect(byId.get(`execution:${failedExec.executionId}`)).toMatchObject({ type: 'EXCEPTION', status: 'OPEN', executionId: failedExec.executionId });

    // VERIFICATION：结果未知 → 待核实 OPEN；已收口 → COMPLETED
    expect(byId.get(`reconciliation:${openCaseId}`)).toMatchObject({ type: 'VERIFICATION', status: 'OPEN', reconciliationCaseId: openCaseId });
    expect(byId.get(`reconciliation:${resolvedCaseId}`)).toMatchObject({ type: 'VERIFICATION', status: 'COMPLETED', reconciliationCaseId: resolvedCaseId });

    // 未伪造状态：待办项不会假装已处理
    expect(todos.every((item) => item.status === 'OPEN' || item.status === 'COMPLETED')).toBe(true);
  });

  it('maps an OUTCOME_UNKNOWN reconciliation case to a pending VERIFICATION todo (结果未知 → 待核实)', async () => {
    const planId = await seedPlan();
    const verifyExec = await seedExecution(planId);
    const caseId = await seedReconciliation(verifyExec, false);

    const response = await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200);
    const row = (response.body as TodoRow[]).find((item) => item.id === `reconciliation:${caseId}`);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ type: 'VERIFICATION', status: 'OPEN', reconciliationCaseId: caseId, executionId: verifyExec.executionId });
  });

  it('isolates todos across users and never leaks another user\'s items', async () => {
    const planId = await seedPlan();
    const failedExec = await seedExecution(planId);
    await pool.query(`UPDATE executions SET status='failed' WHERE id=UUID_TO_BIN(?)`, [failedExec.executionId]);

    const outsiderTodos = await request(app.getHttpServer()).get('/api/todos').set(auth(outsider.token)).expect(200);
    expect((outsiderTodos.body as TodoRow[]).some((item) => item.executionId === failedExec.executionId)).toBe(false);
    expect((outsiderTodos.body as TodoRow[]).some((item) => item.planId === planId)).toBe(false);

    const ownerTodos = await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200);
    expect((ownerTodos.body as TodoRow[]).some((item) => item.executionId === failedExec.executionId)).toBe(true);
  });
});
