import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Session { token: string; userId: string }

describe('P0-1 through P0-3 integration', () => {
  let app: INestApplication;
  let userA: Session;
  let userB: Session;
  let internalConnectionId: string;
  let connectionsService: { invoke(userId: string, connectionId: string, input: { capability: string; requestId: string; idempotencyKey?: string; input: Record<string, unknown> }): Promise<unknown> };
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-credentials-${unique}`;

    const { AppModule } = await import('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    connectionsService = app.get('CONNECTOR_INVOCATION_SERVICE');

    userA = await register(`a-${unique}@example.com`, '用户 A');
    userB = await register(`b-${unique}@example.com`, '用户 B');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set('authorization', `Bearer ${response.body.accessToken}`).expect(200);
    return { token: response.body.accessToken as string, userId: me.body.id as string };
  }

  it('registers ConnectorRegistry adapters and exposes only real P0 connectors', async () => {
    const response = await request(app.getHttpServer()).get('/api/connectors').expect(200);
    expect(response.body.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining(['manual', 'internal', 'webhook']));
    expect(response.body.some((item: { key: string }) => item.key === 'douyin')).toBe(false);
  });

  it('runs ManualConnector through the same permission gate', async () => {
    const created = await request(app.getHttpServer()).post('/api/connections').set('authorization', `Bearer ${userA.token}`).send({ connectorId: 'manual', externalAccountName: '手动输入' }).expect(201);
    const id = created.body.id as string;
    await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'MANUAL_INPUT', granted: true }] }).expect(200);
    const result = await connectionsService.invoke(userA.userId, id, { capability: 'MANUAL_INPUT', requestId: `manual-${unique}`, input: { value: 'hello' } });
    expect(result).toMatchObject({ ok: true, data: { accepted: true, input: { value: 'hello' } } });
  });

  it('creates and reads a connection without returning credential content or reference', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/connections')
      .set('authorization', `Bearer ${userA.token}`)
      .send({ connectorId: 'internal', externalAccountName: '用户 A 的内部服务', credentials: { apiKey: 'must-never-leak' } })
      .expect(201);
    internalConnectionId = response.body.id as string;
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('must-never-leak');
    expect(serialized).not.toMatch(/credential/i);

    const list = await request(app.getHttpServer()).get('/api/connections').set('authorization', `Bearer ${userA.token}`).expect(200);
    expect(list.body.some((item: { id: string }) => item.id === internalConnectionId)).toBe(true);
  });

  it('prevents User B from accessing User A connection', async () => {
    await request(app.getHttpServer()).get(`/api/connections/${internalConnectionId}`).set('authorization', `Bearer ${userB.token}`).expect(404);
    await request(app.getHttpServer()).get(`/api/connections/${internalConnectionId}/permissions`).set('authorization', `Bearer ${userB.token}`).expect(404);
  });

  it('grants, revokes and expires capability permission before invocation', async () => {
    const invoke = () => connectionsService.invoke(userA.userId, internalConnectionId, { capability: 'WRITE_INTERNAL', requestId: new Date().toISOString(), idempotencyKey: `invoke-${unique}`, input: { value: 1 } });
    await expect(invoke()).rejects.toMatchObject({ status: 403 });

    await request(app.getHttpServer()).put(`/api/connections/${internalConnectionId}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'WRITE_INTERNAL', granted: true }] }).expect(200);
    await expect(invoke()).resolves.toMatchObject({ ok: true, data: { recorded: true } });

    await request(app.getHttpServer()).put(`/api/connections/${internalConnectionId}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'WRITE_INTERNAL', granted: false }] }).expect(200);
    await expect(invoke()).rejects.toMatchObject({ status: 403 });

    await request(app.getHttpServer()).put(`/api/connections/${internalConnectionId}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'WRITE_INTERNAL', granted: true, expiresAt: '2020-01-01T00:00:00.000Z' }] }).expect(200);
    await expect(invoke()).rejects.toMatchObject({ status: 403 });
  });

  it('validates then revokes a connection and permanently blocks execution', async () => {
    await request(app.getHttpServer()).put(`/api/connections/${internalConnectionId}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'WRITE_INTERNAL', granted: true }] }).expect(200);
    const validation = await request(app.getHttpServer()).post(`/api/connections/${internalConnectionId}/validate`).set('authorization', `Bearer ${userA.token}`).expect(201);
    expect(validation.body.health.status).toBe('healthy');
    await request(app.getHttpServer()).delete(`/api/connections/${internalConnectionId}`).set('authorization', `Bearer ${userA.token}`).expect(204);
    await expect(connectionsService.invoke(userA.userId, internalConnectionId, { capability: 'WRITE_INTERNAL', requestId: unique, input: {} })).rejects.toMatchObject({ status: 403 });
  });

  it('receives a standard webhook and reserves duplicate-event idempotency', async () => {
    const secret = 'p0-standard-webhook-secret';
    const created = await request(app.getHttpServer()).post('/api/connections').set('authorization', `Bearer ${userA.token}`).send({ connectorId: 'webhook', externalAccountName: '测试 Webhook', credentials: { webhookSecret: secret } }).expect(201);
    const id = created.body.id as string;
    await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set('authorization', `Bearer ${userA.token}`).send({ permissions: [{ capability: 'RECEIVE_WEBHOOK', granted: true }] }).expect(200);
    const payload = { kind: 'test', value: 42 };
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const event = { eventId: `event-${unique}`, requestId: `request-${unique}`, idempotencyKey: `idem-${unique}`, timestamp, signature: createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(payload)}`).digest('hex'), payload };
    const first = await request(app.getHttpServer()).post(`/api/connections/${id}/webhook-events`).set('authorization', `Bearer ${userA.token}`).send(event).expect(201);
    const duplicate = await request(app.getHttpServer()).post(`/api/connections/${id}/webhook-events`).set('authorization', `Bearer ${userA.token}`).send(event).expect(201);
    expect(first.body.duplicate).toBe(false);
    expect(duplicate.body).toEqual({ receiptId: first.body.receiptId, duplicate: true });
  });

  it('reports MySQL, Redis and BullMQ health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', mysql: 'ready', redis: 'PONG', bullmq: 'ready' });
  });
});
