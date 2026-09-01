import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P1 natural language plan creation', { timeout: 60000 }, () => {
  let app: INestApplication;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 11).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-natural-language-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    user = await register(`nl-${unique}@example.com`, '自然语言用户');
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

  it('parses a phone bill intent into a controlled mobile bill draft', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/templates/natural-language/parse')
      .set(auth(user.token))
      .send({ query: '以后每个月话费超过150块再告诉我。' })
      .expect(201);

    expect(response.body).toMatchObject({
      adapter: 'deterministic_fallback',
      template: { key: 'mobile-bill-guard', name: '话费异常守护' },
      canInstallDirectly: true,
      missingFields: [],
    });
    expect(response.body.config).toMatchObject({
      monthlyThreshold: 150,
      percentIncreaseThreshold: 30,
      sourceType: 'manual',
      onlyAbnormalNotify: true,
    });
  });

  it('creates a draft plan from natural language through the template chain', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/templates/natural-language/install')
      .set(auth(user.token))
      .send({ query: '以后每个月话费超过150块再告诉我。' })
      .expect(201);

    const planId = created.body.id as string;
    const version = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions/1`)
      .set(auth(user.token))
      .expect(200);

    expect(created.body.naturalLanguageSummary).toContain('计划草稿');
    expect(version.body).toMatchObject({
      versionNumber: 1,
      templateKey: 'mobile-bill-guard',
      templateConfig: {
        monthlyThreshold: 150,
        percentIncreaseThreshold: 30,
        sourceType: 'manual',
        onlyAbnormalNotify: true,
      },
    });
  });

  it('keeps device consumable intents in controlled draft mode until device data is provided', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/templates/natural-language/parse')
      .set(auth(user.token))
      .send({ query: '提醒我净水器滤芯快到更换时间时准备购买清单。' })
      .expect(201);

    expect(response.body).toMatchObject({
      template: { key: 'device-consumable-reminder', name: '设备耗材提醒' },
      canInstallDirectly: false,
    });
    expect(response.body.missingFields.map((field: { label: string }) => field.label)).toEqual(expect.arrayContaining(['设备编号', '耗材编号']));
  });
});
