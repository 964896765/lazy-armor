import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P1 template system integration', { timeout: 60000 }, () => {
  let app: INestApplication;
  let user: Session;
  let outsider: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-template-credentials-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    user = await register(`templates-${unique}@example.com`, '模板用户');
    outsider = await register(`templates-out-${unique}@example.com`, '模板外部用户');
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

  it('lists the 8 canonical templates for the plan library', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/templates')
      .set(auth(user.token))
      .expect(200);

    expect(response.body).toHaveLength(8);
    expect(response.body.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
      'monthly-bill-summary',
      'mobile-bill-guard',
      'quiet-delivery-guard',
      'family-supply-reminder',
      'video-multi-platform',
      'daily-important-summary',
      'exam-study-plan',
      'device-consumable-reminder',
    ]));
  });

  it('returns template details, config schema and user-language explanations', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/templates/monthly-bill-summary')
      .set(auth(user.token))
      .expect(200);

    expect(response.body).toMatchObject({
      key: 'monthly-bill-summary',
      group: '我的钱',
      name: '月度账单汇总',
      templateVersion: '1',
      details: {
        doesWhat: expect.any(String),
        runsWhen: expect.any(String),
        dataNeeded: expect.any(String),
      },
    });
    expect(response.body.configFields.map((field: { key: string }) => field.key)).toEqual(expect.arrayContaining([
      'planName',
      'summaryDay',
      'sourceType',
      'billingPeriod',
      'showCategories',
      'showMonthOverMonth',
      'anomalyThresholdPercent',
      'notificationPreference',
    ]));
  });

  it('rejects unknown config keys before template install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/monthly-bill-summary/install')
      .set(auth(user.token))
      .send({ config: { summaryDay: 3, unknownField: true } })
      .expect(400);
  });

  it('installs the monthly billing template with controlled config and installed identity', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/monthly-bill-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '我的月度账单',
          summaryDay: 3,
          sourceType: 'manual',
          billingPeriod: 'current_month',
          showCategories: true,
          showMonthOverMonth: true,
          anomalyThresholdPercent: 18,
          notificationPreference: 'summary',
        },
      })
      .expect(201);

    expect(installed.body).toMatchObject({
      status: 'draft',
      activeVersionId: null,
      templateKey: 'monthly-bill-summary',
      templateVersion: '1',
      currentVersion: {
        versionNumber: 1,
        name: '我的月度账单',
        templateKey: 'monthly-bill-summary',
        templateVersion: '1',
        templateConfig: {
          planName: '我的月度账单',
          summaryDay: 3,
          sourceType: 'manual',
          billingPeriod: 'current_month',
          showCategories: true,
          showMonthOverMonth: true,
          anomalyThresholdPercent: 18,
          notificationPreference: 'summary',
        },
      },
    });

    const plans = await request(app.getHttpServer())
      .get('/api/plans')
      .set(auth(user.token))
      .expect(200);
    const listed = plans.body.find((plan: { id: string }) => plan.id === installed.body.id);
    expect(listed).toMatchObject({
      id: installed.body.id,
      name: '我的月度账单',
      status: 'draft',
      templateKey: 'monthly-bill-summary',
      templateVersion: '1',
      hasMissingConnection: false,
    });
    expect(typeof listed.nextExpectedRunAt).toBe('string');

    const version = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(version.body).toMatchObject({
      templateKey: 'monthly-bill-summary',
      templateVersion: '1',
      name: '我的月度账单',
      templateConfig: {
        planName: '我的月度账单',
        summaryDay: 3,
        anomalyThresholdPercent: 18,
      },
    });

    const planDetail = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(planDetail.body).toMatchObject({
      id: installed.body.id,
      name: '我的月度账单',
      currentVersion: {
        name: '我的月度账单',
        templateKey: 'monthly-bill-summary',
      },
    });
  });

  it('installs the phone guard template and editing it creates a new immutable version', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/mobile-bill-guard/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '话费守护',
          monthlyThreshold: 150,
          percentIncreaseThreshold: 30,
          sourceType: 'manual',
          onlyAbnormalNotify: true,
          checkDayOfMonth: 8,
        },
      })
      .expect(201);

    const v2 = await request(app.getHttpServer())
      .post(`/api/templates/plans/${installed.body.id}/version`)
      .set(auth(user.token))
      .send({
        config: {
          planName: '爸妈话费异常守护',
          monthlyThreshold: 180,
          percentIncreaseThreshold: 35,
          sourceType: 'manual',
          onlyAbnormalNotify: true,
          checkDayOfMonth: 8,
        },
      })
      .expect(201);

    expect(v2.body).toMatchObject({
      versionNumber: 2,
      name: '爸妈话费异常守护',
      templateKey: 'mobile-bill-guard',
      templateVersion: '1',
      templateConfig: {
        planName: '爸妈话费异常守护',
        monthlyThreshold: 180,
        percentIncreaseThreshold: 35,
      },
    });

    const v1 = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(v1.body).toMatchObject({
      name: '话费守护',
      templateConfig: {
        planName: '话费守护',
        monthlyThreshold: 150,
        percentIncreaseThreshold: 30,
      },
    });
    expect(v1.body.templateConfig).toMatchObject({
      planName: '话费守护',
      monthlyThreshold: 150,
      percentIncreaseThreshold: 30,
    });
  });

  it('keeps template-installed plans isolated across users', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/monthly-bill-summary/install')
      .set(auth(user.token))
      .send({ config: { summaryDay: 2 } })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}`)
      .set(auth(outsider.token))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/templates/plans/${installed.body.id}/version`)
      .set(auth(outsider.token))
      .send({ config: { summaryDay: 5 } })
      .expect(404);
  });

  it('rejects installing an unknown template key', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/not-exists/install')
      .set(auth(user.token))
      .expect(404);
  });
});
