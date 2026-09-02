import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool } from 'mysql2/promise';
import request from 'supertest';
import { json, urlencoded } from 'express';
import { ExecutionWorker } from '../src/execution/execution-worker.service';

export interface Session {
  token: string;
  userId: string;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export async function bootP2App(unique: string): Promise<{ app: INestApplication; worker: ExecutionWorker; pool: Pool }> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
  process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 5).toString('base64');
  process.env.CREDENTIAL_STORE_PATH ??= `.data/test-p2-${unique}`;
  process.env.SUBSCRIPTION_BILLING_PROVIDER = 'sandbox';
  process.env.SUBSCRIPTION_BILLING_SANDBOX_WEBHOOK_SECRET = 'test-sandbox-subscription-webhook-secret';
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  const captureRawBody = (req: import('express').Request, _res: import('express').Response, body: Buffer) => {
    (req as import('express').Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
  };
  app.use('/api/file-imports', json({ limit: '1400kb', verify: captureRawBody }));
  app.use(json({ limit: '256kb', verify: captureRawBody }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return {
    app,
    worker: app.get(ExecutionWorker),
    pool: createPool({ uri: process.env.DATABASE_URL, connectionLimit: 4, timezone: 'Z' }),
  };
}

export async function register(app: INestApplication, email: string, displayName: string): Promise<Session> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery-staple', displayName })
    .expect(201);
  const me = await request(app.getHttpServer())
    .get('/api/me')
    .set(auth(response.body.accessToken))
    .expect(200);
  return { token: response.body.accessToken as string, userId: me.body.id as string };
}

export async function oauthConnect(app: INestApplication, token: string, provider: string, code: string, redirectUri = 'https://app.example.test/oauth/callback') {
  const started = await request(app.getHttpServer())
    .post(`/api/connections/oauth/${provider}/start`)
    .set(auth(token))
    .send({ redirectUri })
    .expect(201);
  const url = new URL(started.body.authorizationUrl as string);
  const state = url.searchParams.get('state');
  if (!state) throw new Error('Missing OAuth state');
  const completed = await request(app.getHttpServer())
    .post(`/api/connections/oauth/${provider}/callback`)
    .set(auth(token))
    .send({ state, code, redirectUri })
    .expect(201);
  return { started: started.body, state, connection: completed.body };
}

export async function activatePlan(app: INestApplication, token: string, planId: string) {
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
}

export async function dispatchPlan(app: INestApplication, worker: { processExecution(executionId: string): Promise<unknown> }, token: string, planId: string, triggerPayload: Record<string, unknown>) {
  const created = await request(app.getHttpServer())
    .post(`/api/plans/${planId}/executions`)
    .set(auth(token))
    .send({ requestId: `p2-${Date.now()}-${Math.random().toString(16).slice(2)}`, triggerPayload })
    .expect(201);
  await worker.processExecution(created.body.id);
  return request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(token)).expect(200);
}
