import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

interface Session {
  accessToken: string;
  userId: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P0-H3 webhook reliability and restart cleanup', { timeout: 60000 }, () => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let pool: Pool | undefined;
  const apps: INestApplication[] = [];

  afterAll(async () => {
    while (apps.length) {
      await apps.pop()?.close();
    }
    await pool?.end();
    delete process.env.APP_ROLE;
    process.env.NODE_ENV = 'test';
  });

  it('treats same payload duplicates as duplicate, blocks different payloads, rejects future replay, and runs startup cleanup after restart', async () => {
    const app = await bootApp('test', `.data/test-webhook-h3-${unique}`);
    apps.push(app);
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 4, timezone: 'Z' });

    const session = await register(app, `webhook-h3-${unique}@example.com`);
    const secret = 'webhook-h3-secret';
    const connectionId = await createWebhookConnection(app, session.accessToken, secret);

    const payload = { kind: 'same-payload', value: 1 };
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = signPayload(secret, timestamp, payload);
    const first = await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `same-${unique}`,
        requestId: `same-${unique}`,
        idempotencyKey: `same-${unique}`,
        timestamp,
        signature,
        payload,
      })
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `same-${unique}`,
        requestId: `same-duplicate-${unique}`,
        idempotencyKey: `same-${unique}`,
        timestamp,
        signature,
        payload,
      })
      .expect(201);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.receiptId).toBe(first.body.receiptId);

    const [sameRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) count FROM webhook_receipts WHERE connection_id=UUID_TO_BIN(?) AND event_id=?',
      [connectionId, `same-${unique}`],
    );
    expect(Number(sameRows[0].count)).toBe(1);

    const changedPayload = { kind: 'same-payload', value: 2 };
    const changedTimestamp = `${Math.floor(Date.now() / 1000)}`;
    await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `same-${unique}`,
        requestId: `same-conflict-${unique}`,
        idempotencyKey: `same-${unique}`,
        timestamp: changedTimestamp,
        signature: signPayload(secret, changedTimestamp, changedPayload),
        payload: changedPayload,
      })
      .expect(409);

    const futurePayload = { kind: 'future-replay' };
    const futureTimestamp = `${Math.floor(Date.now() / 1000) + 600}`;
    await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `future-${unique}`,
        requestId: `future-${unique}`,
        idempotencyKey: `future-${unique}`,
        timestamp: futureTimestamp,
        signature: signPayload(secret, futureTimestamp, futurePayload),
        payload: futurePayload,
      })
      .expect(403);

    await pool.query(
      'UPDATE webhook_receipts SET expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND), purged_at=NULL WHERE id=UUID_TO_BIN(?)',
      [first.body.receiptId],
    );

    apps.pop();
    await app.close();

    process.env.APP_ROLE = 'api';
    const restarted = await bootApp('development', `.data/test-webhook-h3-restart-${unique}`);
    apps.push(restarted);

    const receipt = await waitForReceiptPurge(pool, first.body.receiptId);
    expect(receipt.payload).toBe('{}');
    expect(receipt.purgedAt).toBeTruthy();
  });
});

async function bootApp(nodeEnv: 'test' | 'development', credentialStorePath: string) {
  process.env.NODE_ENV = nodeEnv;
  process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
  process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
  process.env.CREDENTIAL_STORE_PATH = credentialStorePath;
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

async function register(app: INestApplication, email: string, password = 'correct-horse-battery-staple'): Promise<Session> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, displayName: email.split('@')[0] })
    .expect(201);
  const me = await request(app.getHttpServer())
    .get('/api/me')
    .set(auth(response.body.accessToken))
    .expect(200);
  return { accessToken: response.body.accessToken as string, userId: me.body.id as string };
}

async function createWebhookConnection(app: INestApplication, userToken: string, secret: string) {
  const created = await request(app.getHttpServer())
    .post('/api/connections')
    .set(auth(userToken))
    .send({
      connectorId: 'webhook',
      externalAccountName: 'Webhook Reliability',
      credentials: { webhookSecret: secret },
    })
    .expect(201);
  await request(app.getHttpServer())
    .put(`/api/connections/${created.body.id}/permissions`)
    .set(auth(userToken))
    .send({ permissions: [{ capability: 'RECEIVE_WEBHOOK', granted: true }] })
    .expect(200);
  return created.body.id as string;
}

function signPayload(secret: string, timestamp: string, payload: Record<string, unknown>) {
  return createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(payload)}`).digest('hex');
}

async function waitForReceiptPurge(pool: Pool, receiptId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT payload,purged_at purgedAt FROM webhook_receipts WHERE id=UUID_TO_BIN(?)',
      [receiptId],
    );
    if (rows[0]?.purgedAt) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Webhook startup cleanup did not purge the expired receipt');
}
