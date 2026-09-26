import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';
import { NotificationService } from '../src/notifications/notification.service';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';

interface SearchPlanHit { id: string; name: string | null; description: string | null; status: string }
interface SearchScenarioHit { key: string; domain: string; label: string }
interface SearchExecutionHit { id: string; planId: string; planName: string | null; status: string; resultSummary: string | null; createdAt: string }
interface SearchNotificationHit { id: string; title: string; body: string; priority: string; status: string; createdAt: string }
interface SearchResponse {
  plans: SearchPlanHit[];
  scenarios: SearchScenarioHit[];
  executions: SearchExecutionHit[];
  notifications: SearchNotificationHit[];
}

// /search is read-only and must never reach the agent model. Overriding the model
// with a throwing stub turns any accidental model call into a hard test failure.
const throwingModel = {
  modelId: () => 'throwing-model',
  capability: () => ({ modelId: 'throwing-model', supportsStructuredCompletion: false, supportsToolSelection: false, maxContextTokens: 0 }),
  complete: async () => { throw new Error('AGENT_MODEL must not be called during /search'); },
};

describe.sequential('Search endpoint (UI-5B)', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  let outsider: Session;
  let planId: string;
  let executionId: string;
  let notificationId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const planToken = `搜索计划-${unique}`;
  const notificationToken = `搜索通知-${unique}`;

  beforeAll(async () => {
    const booted = await bootP2App(`search-${unique}`, [{ token: AGENT_MODEL, value: throwingModel }]);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `search-${unique}@example.com`, '搜索用户');
    outsider = await register(app, `search-out-${unique}@example.com`, '搜索外部用户');

    const profile = await request(app.getHttpServer())
      .post('/api/device-profiles')
      .set(auth(user.token))
      .send({ type: '净水器', brand: '小米', model: `Search-${unique}`, purchasedAt: '2027-01-01T00:00:00.000Z', warrantyUntil: '2029-01-01T00:00:00.000Z', maintenanceIntervalDays: 180, sourceType: 'manual' })
      .expect(201);
    const consumable = await request(app.getHttpServer())
      .post('/api/device-consumables')
      .set(auth(user.token))
      .send({ deviceProfileId: profile.body.id, name: '前置滤芯', lastReplacedAt: '2027-05-01T00:00:00.000Z', replacementIntervalDays: 150, remindBeforeDays: 10 })
      .expect(201);
    const installed = await request(app.getHttpServer())
      .post('/api/templates/device-consumable-reminder/install')
      .set(auth(user.token))
      .send({ config: { planName: planToken, deviceProfileId: profile.body.id, consumableId: consumable.body.id, preparationMode: 'shopping_list', notificationPreference: 'summary' } })
      .expect(201);
    planId = installed.body.id as string;
    await activatePlan(app, user.token, planId);
    const execution = await dispatchPlan(app, worker, user.token, planId, { referenceDate: '2027-09-18T08:00:00.000Z' });
    executionId = execution.body.id as string;

    const notification = await app.get(NotificationService).emit({
      userId: user.userId,
      priority: 'P1',
      eventType: 'search_test',
      dedupeKey: `search-notif-${unique}`,
      title: notificationToken,
      body: '这是用于搜索验证的通知正文',
      actionRequired: true,
    });
    notificationId = notification?.id ?? '';
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('returns matching plans in the plans group without calling the model', async () => {
    const response = await request(app.getHttpServer()).get(`/api/search?q=${encodeURIComponent(planToken)}`).set(auth(user.token)).expect(200);
    const body = response.body as SearchResponse;
    expect(body.plans.map((plan) => plan.id)).toContain(planId);
    expect(body.plans.find((plan) => plan.id === planId)?.name).toBe(planToken);
  });

  it('returns matching canonical scenarios in the scenarios group', async () => {
    const response = await request(app.getHttpServer()).get('/api/search?q=%E8%80%97%E6%9D%90').set(auth(user.token)).expect(200);
    const body = response.body as SearchResponse;
    const hit = body.scenarios.find((scenario) => scenario.label === '耗材');
    expect(hit).toBeDefined();
    expect(hit!.domain).toBe('device');
    expect(hit!.key).toBe('consumables');
  });

  it('returns matching executions in the executions group by status', async () => {
    const response = await request(app.getHttpServer()).get('/api/search?q=succeeded').set(auth(user.token)).expect(200);
    const body = response.body as SearchResponse;
    expect(body.executions.map((execution) => execution.id)).toContain(executionId);
  });

  it('returns matching notifications in the notifications group', async () => {
    const response = await request(app.getHttpServer()).get(`/api/search?q=${encodeURIComponent(notificationToken)}`).set(auth(user.token)).expect(200);
    const body = response.body as SearchResponse;
    expect(body.notifications.map((notification) => notification.id)).toContain(notificationId);
  });

  it('isolates plans, executions and notifications across users', async () => {
    const planSearch = await request(app.getHttpServer()).get(`/api/search?q=${encodeURIComponent(planToken)}`).set(auth(outsider.token)).expect(200);
    expect((planSearch.body as SearchResponse).plans.map((plan) => plan.id)).not.toContain(planId);

    const executionSearch = await request(app.getHttpServer()).get('/api/search?q=succeeded').set(auth(outsider.token)).expect(200);
    expect((executionSearch.body as SearchResponse).executions.map((execution) => execution.id)).not.toContain(executionId);

    const notificationSearch = await request(app.getHttpServer()).get(`/api/search?q=${encodeURIComponent(notificationToken)}`).set(auth(outsider.token)).expect(200);
    expect((notificationSearch.body as SearchResponse).notifications.map((notification) => notification.id)).not.toContain(notificationId);
  });

  it('rejects an empty or blank query', async () => {
    await request(app.getHttpServer()).get('/api/search').set(auth(user.token)).expect(400);
    await request(app.getHttpServer()).get('/api/search?q=').set(auth(user.token)).expect(400);
    await request(app.getHttpServer()).get('/api/search?q=%20%20').set(auth(user.token)).expect(400);
  });
});
