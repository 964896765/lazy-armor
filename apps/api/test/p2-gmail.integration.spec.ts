import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { auth, bootP2App, oauthConnect, register, type Session } from './p2-test-helpers';

describe.sequential('P2 Gmail connector', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let gmailConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`gmail-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p2-gmail-${unique}@example.com`, 'P2 Gmail');
    const connected = await oauthConnect(app, user.token, 'gmail', 'gmail-primary');
    gmailConnectionId = connected.connection.id as string;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('reads normalized Gmail metadata', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EMAIL_METADATA', requestId: `gmail-meta-${unique}`, input: {} })
      .expect(201);
    expect(response.body.messages[0]).toMatchObject({
      messageId: expect.any(String),
      threadId: expect.any(String),
      subject: expect.any(String),
      from: expect.any(String),
      to: expect.any(Array),
      occurredAt: expect.any(String),
      labels: expect.any(Array),
      hasAttachments: expect.any(Boolean),
    });
  });

  it('reads Gmail content and prepares a draft', async () => {
    const read = await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EMAIL', requestId: `gmail-read-${unique}`, input: {} })
      .expect(201);
    expect(read.body.messages[0]).toMatchObject({
      plainText: expect.any(String),
      attachments: expect.any(Array),
    });

    const draft = await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'CREATE_DRAFT', requestId: `gmail-draft-${unique}`, input: { subject: '整理一下今天的重点', body: '先帮我准备草稿' } })
      .expect(403);
    expect(draft.body.message).toContain('Execution Engine');
  });

  it('enforces runtime permission revocation immediately', async () => {
    await request(app.getHttpServer())
      .put(`/api/connections/${gmailConnectionId}/permissions`)
      .set(auth(user.token))
      .send({ permissions: [{ capability: 'READ_EMAIL', granted: false }] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EMAIL', requestId: `gmail-denied-${unique}`, input: {} })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/connections/${gmailConnectionId}/permissions`)
      .set(auth(user.token))
      .send({ permissions: [{ capability: 'READ_EMAIL', granted: true }] })
      .expect(200);
  });

  it('maps rate limit and provider unavailable into standard connection states', async () => {
    const limited = await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EMAIL', requestId: `gmail-rate-${unique}`, input: { mode: 'rate_limit' } })
      .expect(400);
    expect(limited.body).toMatchObject({ category: 'RATE_LIMITED', retryable: true });
    const degraded = await request(app.getHttpServer())
      .get(`/api/connections/${gmailConnectionId}`)
      .set(auth(user.token))
      .expect(200);
    expect(degraded.body.status).toBe('degraded');

    await request(app.getHttpServer())
      .post(`/api/connections/${gmailConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EMAIL', requestId: `gmail-unavailable-${unique}`, input: { mode: 'provider_unavailable' } })
      .expect(400);
    const unavailable = await request(app.getHttpServer())
      .get(`/api/connections/${gmailConnectionId}`)
      .set(auth(user.token))
      .expect(200);
    expect(unavailable.body.status).toBe('provider_error');
  });

  it('syncs Gmail messages into important_item_candidates for Daily Summary', async () => {
    const synced = await request(app.getHttpServer())
      .post('/api/important-item-candidates/sync')
      .set(auth(user.token))
      .send({ connectionId: gmailConnectionId, sourceType: 'email' })
      .expect(201);
    expect(synced.body.length).toBeGreaterThan(0);
    const listed = await request(app.getHttpServer())
      .get('/api/important-item-candidates?sourceType=email')
      .set(auth(user.token))
      .expect(200);
    expect(listed.body.length).toBeGreaterThan(0);
    expect(listed.body[0].sourceType).toBe('email');
  });
});
