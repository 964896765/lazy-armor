import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';

describe.sequential('P3 finance representative plans', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p3-finance-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p3-finance-${unique}@example.com`, 'P3 Finance');

    for (const record of [
      { provider: '市政电力', category: '电费', billingPeriod: '2026-12', amount: 100, occurredAt: '2026-12-10T08:00:00.000Z' },
      { provider: '市政电力', category: '电费', billingPeriod: '2027-01', amount: 180, occurredAt: '2027-01-10T08:00:00.000Z' },
      { provider: '市政水务', category: '水费', billingPeriod: '2027-01', amount: 9000, occurredAt: '2027-01-11T08:00:00.000Z' },
    ]) {
      await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({
        ...record,
        currency: 'CNY',
        sourceType: 'internal',
      }).expect(201);
    }
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  async function installAndRun(templateKey: string, config: Record<string, unknown>) {
    const installed = await request(app.getHttpServer())
      .post(`/api/templates/${templateKey}/install`)
      .set(auth(user.token))
      .send({ config })
      .expect(201);
    await activatePlan(app, user.token, installed.body.id);
    const execution = await dispatchPlan(app, worker, user.token, installed.body.id, {
      referenceDate: '2027-01-20T08:00:00.000Z',
    });
    return { planId: installed.body.id as string, execution: execution.body as Record<string, unknown> };
  }

  it('filters a utility guard to its selected category before evaluating and notifying', async () => {
    const result = await installAndRun('utility-bill-guard', {
      category: '电费',
      monthlyThreshold: 200,
      increaseThresholdPercent: 30,
      checkDayOfMonth: 5,
    });

    expect(result.execution.status).toBe('succeeded');
    expect(result.execution.resultSummary).toContain('180.00');
    expect(result.execution.resultSummary).toContain('100.00');
    expect(result.execution.resultSummary).not.toContain('9180.00');

    const notifications = await request(app.getHttpServer())
      .get('/api/notifications?priority=P1')
      .set(auth(user.token))
      .expect(200);
    expect(notifications.body.some((item: { eventType: string }) => item.eventType === 'utility_bill_anomaly')).toBe(true);
  });

  it('runs abnormal-spend classification through the shared engine without money side effects', async () => {
    const result = await installAndRun('abnormal-spend-guard', {
      amountThreshold: 5000,
      increaseThresholdPercent: 50,
      notificationPreference: 'important',
    });

    expect(result.execution.status).toBe('succeeded');
    expect(result.execution.resultSummary).toContain('9180.00');

    const [actions] = await pool.query<RowDataPacket[]>(
      `SELECT pa.action_type actionType
         FROM plan_actions pa
         JOIN plan_versions pv ON pv.id=pa.plan_version_id
        WHERE pv.plan_id=UUID_TO_BIN(?)`,
      [result.planId],
    );
    expect(actions.map((row) => row.actionType)).toEqual(['classify', 'compare', 'summarize', 'notify']);
    expect(actions.some((row) => ['payment', 'transfer', 'purchase', 'place_order'].includes(row.actionType))).toBe(false);

    const [operations] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',
      [result.execution.id],
    );
    expect(Number(operations[0].count)).toBe(0);
  });
});
