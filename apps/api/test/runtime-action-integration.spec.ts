import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import { ActionAdapter } from '../src/execution/action-adapter.service';

describe.sequential('Batch 7 action integration', () => {
  let app: INestApplication; let pool: Pool; let worker: ExecutionWorker; let owner: Session; let stranger: Session;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const definition = (approval = 'never') => ({ name: 'Action integration ' + unique, domain: 'finance', automationLevel: 'L1',
    approvalPolicy: { type: approval, config: {} }, sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
    actions: [{ actionType: 'record', config: { recordType: 'batch7' }, stepOrder: 0 }] });
  const plan = async (approval = 'never') => {
    const created = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(definition(approval)).expect(201);
    await activatePlan(app, owner.token, created.body.id); return created.body.id as string;
  };
  const dispatch = (id: string, key: string) => request(app.getHttpServer()).post('/api/plans/' + id + '/executions')
    .set(auth(owner.token)).send({ requestId: unique + key, triggerPayload: { value: 42 } }).expect(201);
  beforeAll(async () => { ({ app, pool, worker } = await bootP2App('actions-' + unique));
    owner = await register(app, 'actions-' + unique + '@example.com', 'Owner');
    stranger = await register(app, 'actions-other-' + unique + '@example.com', 'Other'); });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('migrates additive intent, adapter, and approval snapshot storage', async () => {
    const [tables] = await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('action_intents','action_adapter_bindings')");
    expect(tables).toHaveLength(2);
  });

  it('creates one intent/adapter per existing execution under concurrent dispatch and runs the original engine', async () => {
    const id = await plan(); const responses = await Promise.all([dispatch(id, 'race'), dispatch(id, 'race'), dispatch(id, 'race')]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    const executionId = responses[0].body.id;
    const intents = await request(app.getHttpServer()).get('/api/executions/' + executionId + '/action-intents').set(auth(owner.token)).expect(200);
    expect(intents.body).toHaveLength(1);
    expect(intents.body[0]).toMatchObject({ effectiveRiskLevel: 'R1', status: 'BOUND_TO_EXECUTION', adapter: { adapterKey: 'existing-runner:record', status: 'BOUND' } });
    await request(app.getHttpServer()).get('/api/action-intents/' + intents.body[0].id).set(auth(stranger.token)).expect(404);
    await request(app.getHttpServer()).get('/api/action-intents/' + intents.body[0].id).expect(401);
    await worker.processExecution(executionId);
    const detail = await request(app.getHttpServer()).get('/api/executions/' + executionId).set(auth(owner.token)).expect(200);
    expect(detail.body.status).toBe('succeeded');
  });

  it('fails closed before an action when the immutable adapter binding is changed', async () => {
    const created = await dispatch(await plan(), 'tamper');
    await pool.query("UPDATE action_adapter_bindings b JOIN action_intents i ON i.id=b.action_intent_id SET b.adapter_key='wrong-adapter' WHERE i.execution_id=UUID_TO_BIN(?)", [created.body.id]);
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get('/api/executions/' + created.body.id).set(auth(owner.token)).expect(200);
    expect(detail.body).toMatchObject({ status: 'failed', errorCode: 'ACTION_ADAPTER_INTEGRITY_ERROR' });
    expect(detail.body.steps[0].attemptCount).toBe(0);
  });

  it('stores an immutable approval snapshot and rejects changed snapshot content', async () => {
    const created = await dispatch(await plan('always'), 'approval'); await worker.processExecution(created.body.id);
    const pending = await request(app.getHttpServer()).get('/api/executions/' + created.body.id).set(auth(owner.token)).expect(200);
    await expect(app.get(ActionAdapter).assertOperation(created.body.id, pending.body.steps[0].id)).rejects.toMatchObject({ code: 'APPROVAL_NOT_VALID' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id, approval_snapshot_json snapshot, approval_snapshot_hash hash FROM approval_requests WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
    expect(rows).toHaveLength(1); expect(rows[0].hash).toMatch(/^[a-f0-9]{64}$/);
    const snapshot = typeof rows[0].snapshot === 'string' ? JSON.parse(rows[0].snapshot) : rows[0].snapshot;
    expect(snapshot).toMatchObject({ executionId: created.body.id, effectiveRisk: 'R1', actionIntentId: expect.any(String) });
    await pool.query("UPDATE approval_requests SET approval_snapshot_json=JSON_SET(approval_snapshot_json,'$.amountMinor',123) WHERE id=UUID_TO_BIN(?)", [rows[0].id]);
    await request(app.getHttpServer()).post('/api/approvals/' + rows[0].id + '/approve').set(auth(owner.token)).send({}).expect(409);
    const [decisions] = await pool.query<RowDataPacket[]>('SELECT id FROM approval_decisions WHERE approval_request_id=UUID_TO_BIN(?)', [rows[0].id]);
    expect(decisions).toHaveLength(0);
  });
});
