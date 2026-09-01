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

describe.sequential('P1 finance canonical plans', { timeout: 60000 }, () => {
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
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-finance-credentials-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`finance-${unique}@example.com`, '账单用户');
    outsider = await register(`finance-out-${unique}@example.com`, '外部用户');
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
      .send({ requestId: `finance-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(response.body.id);
    return request(app.getHttpServer()).get(`/api/executions/${response.body.id}`).set(auth(token)).expect(200);
  }

  it('stores billing records as a controlled internal finance input model with cross-user isolation', async () => {
    await request(app.getHttpServer())
      .post('/api/billing-records')
      .set(auth(user.token))
      .send({ provider: '移动', category: '通信', billingPeriod: '2026-09', amount: 88, currency: 'CNY', occurredAt: '2026-09-05T08:00:00.000Z', sourceType: 'internal' })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get('/api/billing-records?billingPeriod=2026-09')
      .set(auth(user.token))
      .expect(200);
    expect(mine.body).toHaveLength(1);

    const theirs = await request(app.getHttpServer())
      .get('/api/billing-records?billingPeriod=2026-09')
      .set(auth(outsider.token))
      .expect(200);
    expect(theirs.body).toHaveLength(0);
  });

  it('runs monthly billing summary end-to-end from internal billing records and stays silent by default', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/monthly-bill-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          summaryDay: 3,
          sourceType: 'internal',
          billingPeriod: 'current_month',
          showCategories: true,
          showMonthOverMonth: true,
          anomalyThresholdPercent: 20,
          notificationPreference: 'silent',
        },
      })
      .expect(201);

    await activate(installed.body.id, user.token);

    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({ provider: '移动', category: '通信', billingPeriod: '2026-12', amount: 100, currency: 'CNY', occurredAt: '2026-12-05T08:00:00.000Z', sourceType: 'internal' }).expect(201);
    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({ provider: '水费', category: '居家', billingPeriod: '2027-01', amount: 80, currency: 'CNY', occurredAt: '2027-01-03T08:00:00.000Z', sourceType: 'internal' }).expect(201);
    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({ provider: '电费', category: '居家', billingPeriod: '2027-01', amount: 120, currency: 'CNY', occurredAt: '2027-01-04T08:00:00.000Z', sourceType: 'internal' }).expect(201);
    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({ provider: '话费', category: '通信', billingPeriod: '2027-01', amount: 35, currency: 'CNY', occurredAt: '2027-01-05T08:00:00.000Z', sourceType: 'internal' }).expect(201);

    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-01-20T00:00:00.000Z' });
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toContain('月度账单已汇总');
    expect(execution.body.resultSummary).toContain('235.00');

    const notifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(user.token))
      .expect(200);
    expect(notifications.body.some((item: { eventType: string }) => item.eventType === 'billing_monthly_summary_ready')).toBe(false);
  });

  it('keeps phone bill guard silent at 149 and noisy at 151', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/mobile-bill-guard/install')
      .set(auth(user.token))
      .send({
        config: {
          monthlyThreshold: 150,
          percentIncreaseThreshold: 30,
          sourceType: 'manual',
          onlyAbnormalNotify: true,
          checkDayOfMonth: 5,
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const normal = await dispatch(installed.body.id, user.token, { amount: 149, amountChange: { previous: 149, current: 149 } });
    expect(normal.body.resultCode).toBe('CONDITIONS_NOT_MET');

    const abnormal = await dispatch(installed.body.id, user.token, { amount: 151, amountChange: { previous: 151, current: 151 } });
    expect(abnormal.body.status).toBe('succeeded');
    expect(abnormal.body.resultSummary).toContain('151.00');

    const notifications = await request(app.getHttpServer()).get('/api/notifications?priority=P1').set(auth(user.token)).expect(200);
    expect(notifications.body.some((item: { eventType: string }) => item.eventType === 'billing_mobile_bill_anomaly')).toBe(true);
  });

  it('respects percentage boundaries for 125 and 135 against a 30 percent threshold', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/mobile-bill-guard/install')
      .set(auth(user.token))
      .send({
        config: {
          monthlyThreshold: 150,
          percentIncreaseThreshold: 30,
          sourceType: 'manual',
          onlyAbnormalNotify: true,
          checkDayOfMonth: 5,
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const flat = await dispatch(installed.body.id, user.token, { amount: 125, amountChange: { previous: 100, current: 125 } });
    expect(flat.body.resultCode).toBe('CONDITIONS_NOT_MET');

    const spiked = await dispatch(installed.body.id, user.token, { amount: 135, amountChange: { previous: 100, current: 135 } });
    expect(spiked.body.status).toBe('succeeded');
    expect(spiked.body.resultSummary).toContain('135.00');
    expect(spiked.body.resultSummary).toContain('35.00%');
  });
});
