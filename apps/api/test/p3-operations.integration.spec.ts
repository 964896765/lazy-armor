import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';

describe.sequential('P3 lightweight operations workflow', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  let other: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p3-operations-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p3-operations-${unique}@example.com`, 'P3 Operations');
    other = await register(app, `p3-operations-other-${unique}@example.com`, 'P3 Operations Other');
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('records four normalized operational fact types without creating an ERP model', async () => {
    for (const record of [
      { recordType: 'order', subject: '今日已付款订单', quantity: 12, amount: 1250, status: 'paid', needsAttention: false },
      { recordType: 'inventory', subject: '包装箱库存', quantity: 3, status: 'low', needsAttention: true },
      { recordType: 'refund', subject: '退款待核对', quantity: 1, amount: 88, status: 'pending', needsAttention: true },
      { recordType: 'supply', subject: '原料补充', quantity: 20, status: 'scheduled', needsAttention: false },
    ]) {
      await request(app.getHttpServer()).post('/api/operational-records').set(auth(user.token)).send({
        ...record, currency: record.amount === undefined ? undefined : 'CNY', occurredAt: '2027-02-03T10:00:00.000Z', sourceType: 'manual',
      }).expect(201);
    }
    expect((await request(app.getHttpServer()).get('/api/operational-records').set(auth(user.token)).expect(200)).body).toHaveLength(4);
    expect((await request(app.getHttpServer()).get('/api/operational-records').set(auth(other.token)).expect(200)).body).toEqual([]);
    const [audits] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='OPERATIONAL_RECORD_CREATED'", [user.userId]);
    expect(Number(audits[0].count)).toBe(4);
  });

  it('builds an anomaly-first daily summary with no order, refund or purchasing side effect', async () => {
    const installed = await request(app.getHttpServer()).post('/api/templates/operations-daily-summary/install').set(auth(user.token)).send({
      config: { summaryTime: '21:00', notificationPreference: 'summary' },
    }).expect(201);
    await activatePlan(app, user.token, installed.body.id);
    const execution = await dispatchPlan(app, worker, user.token, installed.body.id, { referenceDate: '2027-02-03T21:00:00.000Z' });
    expect(execution.body).toMatchObject({ status: 'succeeded', resultSummary: '今日经营记录 4 条，其中 2 条需要处理。' });
    const summary = execution.body.outputs.find((item: { actionType: string }) => item.actionType === 'summarize');
    expect(summary.output.operationalSummary).toMatchObject({ recordCount: 4, attentionCount: 2, counts: { order: 1, inventory: 1, refund: 1, supply: 1 } });
    const [actions] = await pool.query<RowDataPacket[]>(
      `SELECT pa.action_type actionType FROM plan_actions pa JOIN plan_versions pv ON pv.id=pa.plan_version_id WHERE pv.plan_id=UUID_TO_BIN(?) ORDER BY pa.step_order`,
      [installed.body.id],
    );
    expect(actions.map((row) => row.actionType)).toEqual(['summarize', 'notify']);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [execution.body.id]);
    expect(Number(operations[0].count)).toBe(0);
  });
});
