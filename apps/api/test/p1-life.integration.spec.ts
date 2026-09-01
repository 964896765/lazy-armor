import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionWorker } from '../src/execution/execution-worker.service';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P1 life canonical plans', { timeout: 60000 }, () => {
  let app: INestApplication;
  let worker: ExecutionWorker;
  let user: Session;
  let outsider: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-life-credentials-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`life-${unique}@example.com`, '生活用户');
    outsider = await register(`life-out-${unique}@example.com`, '生活外部用户');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'correct-horse-battery-staple', displayName })
      .expect(201);
    return { token: response.body.accessToken as string };
  }

  async function activate(planId: string, token: string) {
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  }

  async function dispatch(planId: string, token: string, triggerPayload: Record<string, unknown>) {
    const response = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(token))
      .send({ requestId: `life-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(response.body.id);
    return request(app.getHttpServer()).get(`/api/executions/${response.body.id}`).set(auth(token)).expect(200);
  }

  async function listNotifications(token: string) {
    const response = await request(app.getHttpServer()).get('/api/notifications').set(auth(token)).expect(200);
    return response.body as Array<{ eventType: string; title: string; body: string; priority: string }>;
  }

  it('stores logistics snapshots with controlled statuses and cross-user isolation', async () => {
    const trackingNumber = `SF-${unique}-1`;
    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber,
        carrier: 'sf',
        status: 'in_transit',
        latestEvent: '快件离开分拨中心',
        latestEventAt: '2027-01-10T08:00:00.000Z',
        lastUpdatedAt: '2027-01-10T08:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get(`/api/logistics-tracking-snapshots?trackingNumber=${encodeURIComponent(trackingNumber)}`)
      .set(auth(user.token))
      .expect(200);
    expect(mine.body).toHaveLength(1);

    const theirs = await request(app.getHttpServer())
      .get(`/api/logistics-tracking-snapshots?trackingNumber=${encodeURIComponent(trackingNumber)}`)
      .set(auth(outsider.token))
      .expect(200);
    expect(theirs.body).toHaveLength(0);
  });

  it('rejects invalid logistics template config before install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber: `BAD-${unique}`, staleHours: 0, checkInterval: '1h' } })
      .expect(400);
  });

  it('runs quiet delivery guard silently when movement is normal and exposes plan summaries', async () => {
    const trackingNumber = `SF-${unique}-normal`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '盯住回家的快递',
          trackingNumber,
          carrier: 'sf',
          staleHours: 48,
          notifyOnException: true,
          notifyOnDelivered: false,
          checkInterval: '12h',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber,
        carrier: 'sf',
        status: 'in_transit',
        latestEvent: '快件正在运输中',
        latestEventAt: '2027-01-20T00:00:00.000Z',
        lastUpdatedAt: '2027-01-20T00:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);

    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-20T12:00:00.000Z' });
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toBe('检查快递：运输正常。');

    const notifications = await listNotifications(user.token);
    expect(notifications.some((item) => item.eventType.startsWith('logistics_') && item.body.includes('运输正常'))).toBe(false);

    const plan = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}`).set(auth(user.token)).expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'logistics',
      currentStatus: '运输中',
      isException: false,
    });
    expect(typeof plan.body.planCenterSummary.latestCheckAt).toBe('string');
    expect(typeof plan.body.planCenterSummary.nextCheckAt).toBe('string');

    const version = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}/versions/1`).set(auth(user.token)).expect(200);
    expect(version.body.definition.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['summarize', 'notify']);
  });

  it('keeps the stale boundary silent exactly at staleHours and not before', async () => {
    const trackingNumber = `SF-${unique}-boundary`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber, carrier: 'sf', staleHours: 48, checkInterval: '24h' } })
      .expect(201);
    await activate(installed.body.id, user.token);

    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber,
        carrier: 'sf',
        status: 'in_transit',
        latestEvent: '快件正在运输中',
        latestEventAt: '2027-01-18T00:00:00.000Z',
        lastUpdatedAt: '2027-01-18T00:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-20T00:00:00.000Z' });
    expect(execution.body.resultSummary).toBe('检查快递：运输正常。');

    const after = await listNotifications(user.token);
    expect(after.length).toBe(before.length);
  });

  it('sends only one stale notification when repeated stale checks have no status change', async () => {
    const trackingNumber = `SF-${unique}-stale`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber, carrier: 'sf', staleHours: 48, checkInterval: '6h' } })
      .expect(201);
    await activate(installed.body.id, user.token);

    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber,
        carrier: 'sf',
        status: 'in_transit',
        latestEvent: '快件正在运输中',
        latestEventAt: '2027-01-18T08:00:00.000Z',
        lastUpdatedAt: '2027-01-18T08:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);

    const before = await listNotifications(user.token);
    const first = await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-20T12:00:00.000Z' });
    expect(first.body.resultSummary).toContain('52 小时没有新进展');

    const middle = await listNotifications(user.token);
    const afterFirst = middle.filter((item) => item.eventType === 'logistics_stale').length;
    expect(afterFirst).toBe(before.filter((item) => item.eventType === 'logistics_stale').length + 1);

    await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-20T18:00:00.000Z' });
    const finalNotifications = await listNotifications(user.token);
    expect(finalNotifications.filter((item) => item.eventType === 'logistics_stale')).toHaveLength(afterFirst);
  });

  it('keeps delivered executions silent by default and respects delivered notification preference', async () => {
    const silentTracking = `SF-${unique}-delivered-silent`;
    const silent = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber: silentTracking, carrier: 'sf', notifyOnDelivered: false } })
      .expect(201);
    await activate(silent.body.id, user.token);
    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber: silentTracking,
        carrier: 'sf',
        status: 'delivered',
        latestEvent: '已签收',
        latestEventAt: '2027-01-22T08:00:00.000Z',
        lastUpdatedAt: '2027-01-22T08:00:00.000Z',
        deliveredAt: '2027-01-22T08:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);
    const beforeSilent = await listNotifications(user.token);
    const deliveredExecution = await dispatch(silent.body.id, user.token, { referenceDate: '2027-01-22T10:00:00.000Z' });
    expect(deliveredExecution.body.resultSummary).toBe('快递已经签收。');
    const afterSilent = await listNotifications(user.token);
    expect(afterSilent.filter((item) => item.eventType === 'logistics_delivered')).toHaveLength(beforeSilent.filter((item) => item.eventType === 'logistics_delivered').length);

    const noisyTracking = `SF-${unique}-delivered-noisy`;
    const noisy = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber: noisyTracking, carrier: 'sf', notifyOnDelivered: true } })
      .expect(201);
    await activate(noisy.body.id, user.token);
    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber: noisyTracking,
        carrier: 'sf',
        status: 'delivered',
        latestEvent: '已签收',
        latestEventAt: '2027-01-23T08:00:00.000Z',
        lastUpdatedAt: '2027-01-23T08:00:00.000Z',
        deliveredAt: '2027-01-23T08:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);
    const beforeNoisy = await listNotifications(user.token);
    await dispatch(noisy.body.id, user.token, { referenceDate: '2027-01-23T10:00:00.000Z' });
    const afterNoisy = await listNotifications(user.token);
    expect(afterNoisy.filter((item) => item.eventType === 'logistics_delivered')).toHaveLength(beforeNoisy.filter((item) => item.eventType === 'logistics_delivered').length + 1);
  });

  it('notifies on explicit logistics exceptions with natural-language results', async () => {
    const trackingNumber = `SF-${unique}-exception`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/quiet-delivery-guard/install')
      .set(auth(user.token))
      .send({ config: { trackingNumber, carrier: 'sf', notifyOnException: true } })
      .expect(201);
    await activate(installed.body.id, user.token);

    await request(app.getHttpServer())
      .post('/api/logistics-tracking-snapshots')
      .set(auth(user.token))
      .send({
        trackingNumber,
        carrier: 'sf',
        status: 'exception',
        latestEvent: '地址问题',
        latestEventAt: '2027-01-24T08:00:00.000Z',
        lastUpdatedAt: '2027-01-24T08:00:00.000Z',
        sourceType: 'internal',
      })
      .expect(201);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-24T10:00:00.000Z' });
    expect(execution.body.resultSummary).toContain('快递状态异常：地址问题');

    const after = await listNotifications(user.token);
    expect(after.filter((item) => item.eventType === 'logistics_exception')).toHaveLength(before.filter((item) => item.eventType === 'logistics_exception').length + 1);
  });

  it('rejects invalid household template config before install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/family-supply-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          itemName: '纸巾',
          category: '日用',
          lastPurchasedAt: '2027/02/01',
          estimatedUsageDays: 20,
          remindBeforeDays: 5,
          preparationMode: 'shopping_list',
        },
      })
      .expect(400);
  });

  it('stores household profiles with cross-user isolation', async () => {
    const itemName = `纸巾-${unique}`;
    await request(app.getHttpServer())
      .post('/api/household-supply-profiles')
      .set(auth(user.token))
      .send({
        itemName,
        category: '日用',
        lastPurchasedAt: '2027-02-01T00:00:00.000Z',
        quantity: 2,
        estimatedUsageDays: 30,
        sourceType: 'internal',
      })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get(`/api/household-supply-profiles?itemName=${encodeURIComponent(itemName)}`)
      .set(auth(user.token))
      .expect(200);
    expect(mine.body).toHaveLength(1);

    const theirs = await request(app.getHttpServer())
      .get(`/api/household-supply-profiles?itemName=${encodeURIComponent(itemName)}`)
      .set(auth(outsider.token))
      .expect(200);
    expect(theirs.body).toHaveLength(0);
  });

  it('calculates run-out dates deterministically and stays silent while supply is still sufficient', async () => {
    const itemName = `饮用水-${unique}`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/family-supply-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '家里饮用水提醒',
          itemName,
          category: '日用',
          lastPurchasedAt: '2027-02-01',
          purchaseQuantity: 2,
          estimatedUsageDays: 20,
          remindBeforeDays: 5,
          preparationMode: 'reminder',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-02-05T00:00:00.000Z' });
    expect(execution.body.resultSummary).toBe(`${itemName}预计还有 16 天。`);

    const after = await listNotifications(user.token);
    expect(after.length).toBe(before.length);

    const plan = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}`).set(auth(user.token)).expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'household',
      currentStatus: `${itemName}预计还有 16 天。`,
    });
    expect(plan.body.planCenterSummary.estimatedRunOutAt).toContain('2027-02-21');
    expect(plan.body.planCenterSummary.nextReminderAt).toContain('2027-02-16');
  });

  it('enters reminder mode on the remindBeforeDays boundary', async () => {
    const itemName = `洗衣液-${unique}`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/family-supply-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          itemName,
          category: '清洁',
          lastPurchasedAt: '2027-02-01',
          purchaseQuantity: 1,
          estimatedUsageDays: 20,
          remindBeforeDays: 5,
          preparationMode: 'reminder',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-02-16T00:00:00.000Z' });
    expect(execution.body.resultSummary).toBe(`${itemName}预计 5 天后用完，已提醒你。`);

    const after = await listNotifications(user.token);
    expect(after.filter((item) => item.eventType === 'household_supply_reminder')).toHaveLength(before.filter((item) => item.eventType === 'household_supply_reminder').length + 1);
  });

  it('prepares a shopping-list item instead of placing any order automatically', async () => {
    const itemName = `纸巾-${unique}-shopping`;
    const installed = await request(app.getHttpServer())
      .post('/api/templates/family-supply-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          itemName,
          category: '日用',
          lastPurchasedAt: '2027-02-01',
          purchaseQuantity: 3,
          estimatedUsageDays: 12,
          remindBeforeDays: 4,
          preparationMode: 'shopping_list',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-02-10T00:00:00.000Z' });
    expect(execution.body.resultSummary).toBe(`${itemName}预计 3 天后用完，已加入补货清单。`);

    const prepared = await request(app.getHttpServer())
      .get('/api/prepared-shopping-items?status=prepared')
      .set(auth(user.token))
      .expect(200);
    const matched = prepared.body.find((item: { itemName: string }) => item.itemName === itemName);
    expect(matched).toMatchObject({
      itemName,
      quantitySuggestion: 3,
      status: 'prepared',
    });

    const version = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}/versions/1`).set(auth(user.token)).expect(200);
    expect(version.body.definition.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['summarize', 'prepare_purchase', 'notify']);
    expect(version.body.definition.actions.some((action: { actionType: string }) => action.actionType === 'create_order')).toBe(false);
  });

  it('creates a new immutable plan version when household usage settings are updated', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/family-supply-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '滤芯提醒',
          itemName: '净水滤芯',
          category: '耗材',
          lastPurchasedAt: '2027-03-01',
          purchaseQuantity: 1,
          estimatedUsageDays: 90,
          remindBeforeDays: 10,
          preparationMode: 'reminder',
        },
      })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .post(`/api/templates/plans/${installed.body.id}/version`)
      .set(auth(user.token))
      .send({
        config: {
          planName: '滤芯提醒',
          itemName: '净水滤芯',
          category: '耗材',
          lastPurchasedAt: '2027-03-15',
          purchaseQuantity: 2,
          estimatedUsageDays: 120,
          remindBeforeDays: 15,
          preparationMode: 'shopping_list',
        },
      })
      .expect(201);

    expect(updated.body).toMatchObject({
      versionNumber: 2,
      templateKey: 'family-supply-reminder',
      templateConfig: {
        lastPurchasedAt: '2027-03-15',
        purchaseQuantity: 2,
        estimatedUsageDays: 120,
        preparationMode: 'shopping_list',
      },
    });

    const original = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(original.body.templateConfig).toMatchObject({
      lastPurchasedAt: '2027-03-01',
      purchaseQuantity: 1,
      estimatedUsageDays: 90,
      preparationMode: 'reminder',
    });
  });
});
