import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';

interface RecentPlanRow {
  planId: string;
  planName: string | null;
  planStatus: string;
  latestExecutionId: string | null;
  executionStatus: string | null;
  approvalStatus: string | null;
  resultState: string | null;
  consumerOutcome: { outcome: string | null; title: string; reason: string };
  resultSummary: string | null;
  lastActivityAt: string | null;
  hasPendingConfirmation: boolean;
  needsUserAction: boolean;
}

describe.sequential('P5 Today recent plans projection', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  let outsider: Session;
  let planId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p5-today-recent-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p5-today-recent-${unique}@example.com`, 'Today Recent 用户');
    outsider = await register(app, `p5-today-recent-out-${unique}@example.com`, 'Today Recent 外部用户');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('projects a not-yet-run plan as a null outcome (never success) and isolates across users', async () => {
    const profile = await request(app.getHttpServer())
      .post('/api/device-profiles')
      .set(auth(user.token))
      .send({
        type: '净水器',
        brand: '小米',
        model: `P5-Pro-${unique}`,
        purchasedAt: '2027-01-01T00:00:00.000Z',
        warrantyUntil: '2029-01-01T00:00:00.000Z',
        maintenanceIntervalDays: 180,
        sourceType: 'manual',
      })
      .expect(201);
    const consumable = await request(app.getHttpServer())
      .post('/api/device-consumables')
      .set(auth(user.token))
      .send({
        deviceProfileId: profile.body.id,
        name: '前置滤芯',
        lastReplacedAt: '2027-05-01T00:00:00.000Z',
        replacementIntervalDays: 150,
        remindBeforeDays: 10,
      })
      .expect(201);
    const installed = await request(app.getHttpServer())
      .post('/api/templates/device-consumable-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '净水器滤芯提醒',
          deviceProfileId: profile.body.id,
          consumableId: consumable.body.id,
          preparationMode: 'shopping_list',
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    planId = installed.body.id as string;
    await activatePlan(app, user.token, planId);

    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    const recent = today.body.recentPlans as RecentPlanRow[];
    const mine = recent.find((item) => item.planId === planId);
    expect(mine).toBeDefined();
    expect(mine!.planName).toBe('净水器滤芯提醒');
    expect(mine!.planStatus).toBe('active');
    expect(mine!.latestExecutionId).toBeNull();
    expect(mine!.executionStatus).toBeNull();
    expect(mine!.consumerOutcome.outcome).toBeNull();
    expect(mine!.consumerOutcome.outcome).not.toBe('SUCCESS');
    expect(mine!.needsUserAction).toBe(false);
    expect(mine!.hasPendingConfirmation).toBe(false);

    const outsiderToday = await request(app.getHttpServer()).get('/api/today').set(auth(outsider.token)).expect(200);
    const outsiderPlans = outsiderToday.body.recentPlans as RecentPlanRow[];
    expect(outsiderPlans.some((item) => item.planId === planId)).toBe(false);
  });

  it('projects a succeeded execution as SUCCESS with the latest execution and a traceable summary', async () => {
    const execution = await dispatchPlan(app, worker, user.token, planId, {
      referenceDate: '2027-09-18T08:00:00.000Z',
    });
    expect(execution.body.status).toBe('succeeded');

    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    const recent = today.body.recentPlans as RecentPlanRow[];
    const mine = recent.find((item) => item.planId === planId);
    expect(mine).toBeDefined();
    expect(mine!.latestExecutionId).toBe(execution.body.id);
    expect(mine!.executionStatus).toBe('succeeded');
    expect(mine!.resultState).toBe('SUCCEEDED');
    expect(mine!.consumerOutcome.outcome).toBe('SUCCESS');
    expect(mine!.consumerOutcome.title).toBe('已完成');
    expect(mine!.resultSummary).toBeTruthy();
    expect(mine!.lastActivityAt).toBeTruthy();
    expect(mine!.needsUserAction).toBe(false);
    expect(mine!.hasPendingConfirmation).toBe(false);
  });
});
