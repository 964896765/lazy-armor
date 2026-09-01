import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P2 connection lifecycle', () => {
  let app: INestApplication;
  let pool: Pool;
  let userA: Session;
  let userB: Session;
  const redirectUri = 'https://app.example.test/oauth/callback';
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`connection-lifecycle-${unique}`);
    app = booted.app;
    pool = booted.pool;
    userA = await register(app, `p2-connection-a-${unique}@example.com`, 'P2 Connection A');
    userB = await register(app, `p2-connection-b-${unique}@example.com`, 'P2 Connection B');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  async function start(provider: string, token: string) {
    const started = await request(app.getHttpServer())
      .post(`/api/connections/oauth/${provider}/start`)
      .set(auth(token))
      .send({ redirectUri })
      .expect(201);
    const state = new URL(started.body.authorizationUrl as string).searchParams.get('state');
    if (!state) throw new Error('Missing state');
    return { state, started: started.body };
  }

  it('authorizes, callbacks, consumes state once, and binds the callback to the current user', async () => {
    const { state } = await start('gmail', userA.token);
    const created = await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state, code: 'gmail-primary', redirectUri })
      .expect(201);
    expect(created.body).toMatchObject({ connectorId: 'gmail', status: 'connected' });

    await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state, code: 'gmail-primary', redirectUri })
      .expect(403);

    const other = await start('gmail', userA.token);
    await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userB.token))
      .send({ state: other.state, code: 'gmail-primary', redirectUri })
      .expect(403);
  });

  it('refreshes expired credentials during validate and keeps the connection connected', async () => {
    const { state } = await start('gmail', userA.token);
    const created = await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state, code: 'gmail-expired', redirectUri })
      .expect(201);
    const validated = await request(app.getHttpServer())
      .post(`/api/connections/${created.body.id}/validate`)
      .set(auth(userA.token))
      .expect(201);
    expect(validated.body.connection.status).toBe('connected');
    expect(validated.body.health.status).toBe('healthy');
  });

  it('marks refresh-invalid credentials as reauthorization_required', async () => {
    const { state } = await start('gmail', userA.token);
    const created = await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state, code: 'gmail-refresh-invalid', redirectUri })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/connections/${created.body.id}/validate`)
      .set(auth(userA.token))
      .expect(403);
    const reloaded = await request(app.getHttpServer())
      .get(`/api/connections/${created.body.id}`)
      .set(auth(userA.token))
      .expect(200);
    expect(reloaded.body.status).toBe('reauthorization_required');
  });

  it('supports reconnect, user isolation, local revoke fail-closed, and audit logging', async () => {
    const { state } = await start('gmail', userA.token);
    const created = await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state, code: 'gmail-primary', redirectUri })
      .expect(201);
    const connectionId = created.body.id as string;

    await request(app.getHttpServer()).get(`/api/connections/${connectionId}`).set(auth(userB.token)).expect(404);
    const reconnect = await request(app.getHttpServer())
      .post(`/api/connections/${connectionId}/reconnect`)
      .set(auth(userA.token))
      .send({ redirectUri })
      .expect(201);
    const reconnectState = new URL(reconnect.body.authorizationUrl as string).searchParams.get('state');
    await request(app.getHttpServer())
      .post('/api/connections/oauth/gmail/callback')
      .set(auth(userA.token))
      .send({ state: reconnectState, code: 'gmail-work', redirectUri })
      .expect(201);
    const reloaded = await request(app.getHttpServer())
      .get(`/api/connections/${connectionId}`)
      .set(auth(userA.token))
      .expect(200);
    expect(reloaded.body.externalAccountName).toContain('gmail-work');

    await request(app.getHttpServer())
      .delete(`/api/connections/${connectionId}`)
      .set(auth(userA.token))
      .expect(204);
    const revoked = await request(app.getHttpServer())
      .get(`/api/connections/${connectionId}`)
      .set(auth(userA.token))
      .expect(200);
    expect(revoked.body.status).toBe('revoked');

    const [auditRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM audit_logs WHERE action IN ('CONNECTION_CREATED','CONNECTION_REAUTHORIZED','CONNECTION_REVOKED') AND resource_id=?",
      [connectionId],
    );
    expect(Number(auditRows[0].count)).toBeGreaterThanOrEqual(3);
  });
});
