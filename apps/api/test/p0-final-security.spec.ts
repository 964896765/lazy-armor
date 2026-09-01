import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { assertProductionSafe, parseEnv } from '@lazy-armor/config';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { SnapshotSanitizer } from '../src/common/snapshot-sanitizer.service';

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P0 Final security hardening', () => {
  let app: INestApplication;
  let pool: Pool;
  let webhookRetention: { cleanup(now?: Date, batchSize?: number): Promise<{ purged: number }> };
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 6).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-final-security-${unique}`;

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    webhookRetention = app.get('WEBHOOK_RETENTION_SERVICE');
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 4, timezone: 'Z' });
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  async function register(email: string, password = 'correct-horse-battery-staple'): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName: email.split('@')[0] })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(response.body.accessToken))
      .expect(200);
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
      userId: me.body.id as string,
    };
  }

  async function createWebhookConnection(userToken: string, secret: string) {
    const created = await request(app.getHttpServer())
      .post('/api/connections')
      .set(auth(userToken))
      .send({
        connectorId: 'webhook',
        externalAccountName: 'Signed Webhook',
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

  it('rotates refresh tokens and revokes the whole family on reuse', async () => {
    const session = await register(`refresh-${unique}@example.com`);
    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(201);

    expect(rotated.body.refreshToken).not.toBe(session.refreshToken);
    expect(rotated.body.accessToken).not.toBe(session.accessToken);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('revokes the current session on logout and invalidates the access token', async () => {
    const session = await register(`logout-${unique}@example.com`);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(session.accessToken))
      .expect(401);
  });

  it('uses uniform login errors and rate-limits repeated failures', async () => {
    const password = 'correct-horse-battery-staple';
    const existing = await register(`login-${unique}@example.com`, password);
    void existing;

    const wrongExisting = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `login-${unique}@example.com`, password: 'wrong-password' })
      .expect(401);
    const wrongMissing = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `missing-${unique}@example.com`, password: 'wrong-password' })
      .expect(401);

    expect(wrongExisting.body).toEqual(wrongMissing.body);
    expect(wrongExisting.body.message).toBe('Invalid email or password');

    const target = `rate-limit-${unique}@example.com`;
    await register(target, password);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target, password: 'wrong-password' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: target, password: 'wrong-password' })
      .expect(429);
  });

  it('rejects expired password reset tokens', async () => {
    const session = await register(`reset-${unique}@example.com`);
    const rawToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await pool.query(
      "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,used_at,created_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE),NULL,UTC_TIMESTAMP(6))",
      [session.userId, tokenHash],
    );

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'new-correct-horse-battery-staple' })
      .expect(401);
  });

  it('enforces admin RBAC and audits readonly diagnostics access', async () => {
    const normal = await register(`admin-user-${unique}@example.com`);
    const readonly = await register(`admin-readonly-${unique}@example.com`);
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', readonly.userId]);

    await request(app.getHttpServer())
      .get('/api/admin/diagnostics')
      .set(auth(normal.accessToken))
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/admin/diagnostics')
      .set(auth(readonly.accessToken))
      .expect(200);

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM audit_logs WHERE action='ADMIN_DIAGNOSTICS_VIEWED' AND user_id=UUID_TO_BIN(?)",
      [readonly.userId],
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('rejects bad webhook signatures and records the failure in audit', async () => {
    const session = await register(`webhook-bad-${unique}@example.com`);
    const connectionId = await createWebhookConnection(session.accessToken, 'top-secret');
    const payload = { kind: 'signed', value: 1 };
    const timestamp = `${Math.floor(Date.now() / 1000)}`;

    await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `event-bad-${unique}`,
        requestId: `request-bad-${unique}`,
        idempotencyKey: `idem-bad-${unique}`,
        timestamp,
        signature: 'not-a-valid-signature',
        payload,
      })
      .expect(403);

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM audit_logs WHERE action='WEBHOOK_SIGNATURE_REJECTED' AND resource_id=?",
      [connectionId],
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('rejects expired signed webhook timestamps', async () => {
    const session = await register(`webhook-expired-${unique}@example.com`);
    const secret = 'signed-secret';
    const connectionId = await createWebhookConnection(session.accessToken, secret);
    const payload = { kind: 'signed', value: 2 };
    const timestamp = `${Math.floor(Date.now() / 1000) - 600}`;
    const signature = signPayload(secret, timestamp, payload);

    await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/webhook-events`)
      .set(auth(session.accessToken))
      .send({
        eventId: `event-expired-${unique}`,
        requestId: `request-expired-${unique}`,
        idempotencyKey: `idem-expired-${unique}`,
        timestamp,
        signature,
        payload,
      })
      .expect(403);
  });

  it('rotates a fixed Credential reference to a new version and resolves only the current secret', async () => {
    const session = await register(`credential-rotation-${unique}@example.com`);
    const connectionId = await createWebhookConnection(session.accessToken, 'version-one-secret');
    const payload = { kind: 'credential-rotation' };
    const firstTimestamp = `${Math.floor(Date.now() / 1000)}`;
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/webhook-events`).set(auth(session.accessToken)).send({
      eventId: `rotation-v1-${unique}`, requestId: `rotation-v1-${unique}`, idempotencyKey: `rotation-v1-${unique}`,
      timestamp: firstTimestamp, signature: signPayload('version-one-secret', firstTimestamp, payload), payload,
    }).expect(201);

    const rotated = await request(app.getHttpServer()).post(`/api/connections/${connectionId}/credentials/rotate`).set(auth(session.accessToken)).send({ credentials: { webhookSecret: 'version-two-secret' } }).expect(201);
    expect(rotated.body.credentialVersion).toBe(2);

    const oldTimestamp = `${Math.floor(Date.now() / 1000)}`;
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/webhook-events`).set(auth(session.accessToken)).send({
      eventId: `rotation-old-${unique}`, requestId: `rotation-old-${unique}`, idempotencyKey: `rotation-old-${unique}`,
      timestamp: oldTimestamp, signature: signPayload('version-one-secret', oldTimestamp, payload), payload,
    }).expect(403);
    const newTimestamp = `${Math.floor(Date.now() / 1000)}`;
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/webhook-events`).set(auth(session.accessToken)).send({
      eventId: `rotation-v2-${unique}`, requestId: `rotation-v2-${unique}`, idempotencyKey: `rotation-v2-${unique}`,
      timestamp: newTimestamp, signature: signPayload('version-two-secret', newTimestamp, payload), payload,
    }).expect(201);

    const [versions] = await pool.query<RowDataPacket[]>("SELECT cr.current_version currentVersion, cv.version, cv.status FROM credential_refs cr JOIN connections c ON c.credential_ref_id=cr.id JOIN credential_versions cv ON cv.credential_ref_id=cr.id WHERE c.id=UUID_TO_BIN(?) ORDER BY cv.version", [connectionId]);
    expect(versions.map((row) => [Number(row.version), row.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    expect(Number(versions[0].currentVersion)).toBe(2);
  });

  it('stores only a minimal Webhook snapshot and purges expired raw-storage fields without deleting the receipt', async () => {
    const session = await register(`webhook-retention-${unique}@example.com`);
    const connectionId = await createWebhookConnection(session.accessToken, 'retention-secret');
    const payload = { kind: 'retention', customerEmail: 'private@example.com', nested: { token: 'must-not-persist' }, items: [1, 2, 3] };
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const response = await request(app.getHttpServer()).post(`/api/connections/${connectionId}/webhook-events`).set(auth(session.accessToken)).send({
      eventId: `retention-${unique}`, requestId: `retention-${unique}`, idempotencyKey: `retention-${unique}`,
      timestamp, signature: signPayload('retention-secret', timestamp, payload), payload,
    }).expect(201);
    const [before] = await pool.query<RowDataPacket[]>('SELECT payload,payload_snapshot_json snapshot,payload_size_bytes sizeBytes,expires_at expiresAt,purged_at purgedAt FROM webhook_receipts WHERE id=UUID_TO_BIN(?)', [response.body.receiptId]);
    expect(before[0].payload).toBe('{}');
    expect(JSON.stringify(before[0].snapshot)).not.toContain('private@example.com');
    expect(JSON.stringify(before[0].snapshot)).not.toContain('must-not-persist');
    expect(Number(before[0].sizeBytes)).toBeGreaterThan(0);
    expect(before[0].expiresAt).toBeTruthy();

    await pool.query('UPDATE webhook_receipts SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [response.body.receiptId]);
    expect((await webhookRetention.cleanup()).purged).toBeGreaterThanOrEqual(1);
    const [after] = await pool.query<RowDataPacket[]>('SELECT payload,purged_at purgedAt FROM webhook_receipts WHERE id=UUID_TO_BIN(?)', [response.body.receiptId]);
    expect(after).toHaveLength(1);
    expect(after[0].payload).toBe('{}');
    expect(after[0].purgedAt).toBeTruthy();
  });

  it('sanitizes deep objects, arrays, bearer tokens, query tokens and cookie text', async () => {
    const sanitizer = new SnapshotSanitizer();
    const sanitized = sanitizer.sanitize({
      nested: [{ Authorization: 'Bearer abc.def.ghi' }, { COOKIE: 'sid=secret-cookie' }],
      query: 'https://example.com/callback?token=abc123',
      mixedCase: { Refresh_Token: 'refresh-secret', api_key: 'api-secret' },
    });
    const text = sanitizer.sanitizeText('Authorization: Bearer abc.def.ghi Cookie=session-secret token=abc123');
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('secret-cookie');
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('api-secret');
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('session-secret');
    expect(text).toContain('[REDACTED]');
  });

  it('fails closed for unsafe production environment settings', async () => {
    expect(() =>
      assertProductionSafe(parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod.example.com/lazy_armor',
        REDIS_URL: 'redis://prod.example.com:6379',
        JWT_SECRET: 'a'.repeat(32),
        CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
        CREDENTIAL_PROVIDER: 'local',
        ALLOWED_ORIGINS: 'https://app.example.com',
      })),
    ).toThrow(/CREDENTIAL_PROVIDER=production/);

    expect(() =>
      assertProductionSafe(parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod.example.com/lazy_armor',
        REDIS_URL: 'redis://prod.example.com:6379',
        JWT_SECRET: 'a'.repeat(32),
        CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
        CREDENTIAL_PROVIDER: 'production',
        ALLOWED_ORIGINS: '*',
      })),
    ).toThrow(/ALLOWED_ORIGINS must not contain "\*"/);

    expect(() =>
      assertProductionSafe(parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod.example.com/lazy_armor',
        REDIS_URL: 'redis://prod.example.com:6379',
        JWT_SECRET: 'a'.repeat(32),
        CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
        CREDENTIAL_PROVIDER: 'production',
      })),
    ).toThrow(/ALLOWED_ORIGINS must declare the production CORS allowlist/);
  });

  it('never leaks stack traces or internal details from the exception filter', async () => {
    const filter = new AllExceptionsFilter();
    const response = {
      statusCode: 0,
      payload: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.payload = body;
        return this;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    };

    filter.catch(new Error('SQLSTATE[HY000] path=/srv/app secret=abc123'), host as never);

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});
