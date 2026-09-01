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

describe.sequential('P1 device canonical plan', { timeout: 60000 }, () => {
  let app: INestApplication;
  let worker: ExecutionWorker;
  let user: Session;
  let outsider: Session;
  let profileId: string;
  let consumableId: string;
  let planId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-device-credentials-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`device-${unique}@example.com`, '设备用户');
    outsider = await register(`device-out-${unique}@example.com`, '设备外部用户');
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

  async function activate(currentPlanId: string, token: string) {
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/versions/1/apply`).set(auth(token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  }

  async function dispatch(currentPlanId: string, token: string, triggerPayload: Record<string, unknown>) {
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${currentPlanId}/executions`)
      .set(auth(token))
      .send({ requestId: `device-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(token)).expect(200);
    return detail.body as { resultSummary: string | null; status: string };
  }

  it('creates a formal device profile and consumable, then installs the reminder template', async () => {
    const profile = await request(app.getHttpServer())
      .post('/api/device-profiles')
      .set(auth(user.token))
      .send({
        type: '净水器',
        brand: '小米',
        model: `净水器Pro-${unique}`,
        purchasedAt: '2026-12-01T00:00:00.000Z',
        warrantyUntil: '2028-12-01T00:00:00.000Z',
        maintenanceIntervalDays: 180,
        sourceType: 'manual',
      })
      .expect(201);
    profileId = profile.body.id as string;

    const consumable = await request(app.getHttpServer())
      .post('/api/device-consumables')
      .set(auth(user.token))
      .send({
        deviceProfileId: profileId,
        name: '前置滤芯',
        lastReplacedAt: '2027-01-01T00:00:00.000Z',
        replacementIntervalDays: 150,
        remindBeforeDays: 10,
      })
      .expect(201);
    consumableId = consumable.body.id as string;

    await request(app.getHttpServer())
      .post('/api/templates/device-consumable-reminder/install')
      .set(auth(user.token))
      .send({ config: { deviceProfileId: 'bad-id', consumableId } })
      .expect(400);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/device-consumable-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '净水器滤芯提醒',
          deviceProfileId: profileId,
          consumableId,
          preparationMode: 'shopping_list',
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    planId = installed.body.id as string;

    const version = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(version.body.definition.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['summarize', 'prepare_purchase', 'notify']);
    expect(version.body.definition.actions.some((action: { actionType: string }) => action.actionType === 'create_order')).toBe(false);
    await activate(planId, user.token);
  });

  it('stays silent during the normal replacement cycle and exposes device plan summary', async () => {
    const execution = await dispatch(planId, user.token, { referenceDate: '2027-05-10T00:00:00.000Z' });
    expect(execution.status).toBe('succeeded');
    expect(execution.resultSummary).toBe('小米 净水器Pro-' + unique + '的前置滤芯预计还有 21 天需要更换。');

    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(today.body.alerts.some((item: { body: string }) => item.body.includes('前置滤芯'))).toBe(false);

    const plan = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(user.token)).expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'device',
      consumableName: '前置滤芯',
      remainingDays: 21,
      nearReplacement: false,
    });
  });

  it('prepares a purchase list and shows a Today alert when replacement is near', async () => {
    const execution = await dispatch(planId, user.token, { referenceDate: '2027-05-25T00:00:00.000Z' });
    expect(execution.resultSummary).toBe('前置滤芯预计 6 天后需要更换，已准备购买清单。');

    const prepared = await request(app.getHttpServer())
      .get('/api/prepared-shopping-items?status=prepared')
      .set(auth(user.token))
      .expect(200);
    expect(prepared.body.some((item: { itemName: string }) => item.itemName.includes('前置滤芯'))).toBe(true);

    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(today.body.alerts.some((item: { title: string; body: string }) => item.title.includes('前置滤芯') || item.body.includes('前置滤芯'))).toBe(true);
  });

  it('recalculates expected replacement time after updating the last replaced date', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/api/device-consumables/${consumableId}/replacement`)
      .set(auth(user.token))
      .send({ lastReplacedAt: '2027-05-25T00:00:00.000Z' })
      .expect(200);
    expect(updated.body.expectedReplaceAt).toContain('2027-10-22');

    const execution = await dispatch(planId, user.token, { referenceDate: '2027-06-01T00:00:00.000Z' });
    expect(execution.resultSummary).toBe('小米 净水器Pro-' + unique + '的前置滤芯预计还有 143 天需要更换。');
  });

  it('keeps device data isolated per user', async () => {
    const outsiderProfiles = await request(app.getHttpServer())
      .get('/api/device-profiles')
      .set(auth(outsider.token))
      .expect(200);
    expect(outsiderProfiles.body.some((item: { id: string }) => item.id === profileId)).toBe(false);

    const outsiderConsumables = await request(app.getHttpServer())
      .get('/api/device-consumables')
      .set(auth(outsider.token))
      .expect(200);
    expect(outsiderConsumables.body.some((item: { id: string }) => item.id === consumableId)).toBe(false);
  });
});
