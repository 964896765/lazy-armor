import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { auth, bootP2App, oauthConnect, register, type Session } from './p2-test-helpers';

describe.sequential('P2 plan connection awareness', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`plan-connections-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p2-plan-connections-${unique}@example.com`, 'P2 Plan Connections');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('keeps a draft with missing providers, blocks Apply, then binds via a new immutable version', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(user.token))
      .send({ config: {
        planName: `等待邮箱连接-${unique}`,
        summaryTime: '07:30',
        includedSources: ['email'],
        lookAheadHours: 24,
        includeCalendar: false,
        includeMessages: true,
        maxItems: 5,
        notificationPreference: 'summary',
      } })
      .expect(201);

    expect(installed.body).toMatchObject({ status: 'draft', hasMissingConnection: true });
    expect(installed.body.missingConnections).toEqual([
      expect.objectContaining({ providerKey: 'gmail', providerName: 'Gmail' }),
    ]);
    await request(app.getHttpServer())
      .post(`/api/plans/${installed.body.id}/versions/1/apply`)
      .set(auth(user.token))
      .expect(400);

    const versionOne = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(versionOne.body.definition.sources.find((source: { sourceType: string }) => source.sourceType === 'email').connectionId).toBeNull();

    const connected = await oauthConnect(app, user.token, 'gmail', 'gmail-plan-awareness');
    const resolved = await request(app.getHttpServer())
      .post(`/api/plans/${installed.body.id}/connections/resolve`)
      .set(auth(user.token))
      .expect(201);
    expect(resolved.body).toMatchObject({ hasMissingConnection: false, currentVersion: { versionNumber: 2 } });

    const versionOneAgain = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(versionOneAgain.body.definition.sources.find((source: { sourceType: string }) => source.sourceType === 'email').connectionId).toBeNull();
    const versionTwo = await request(app.getHttpServer())
      .get(`/api/plans/${installed.body.id}/versions/2`)
      .set(auth(user.token))
      .expect(200);
    expect(versionTwo.body.definition.sources.find((source: { sourceType: string }) => source.sourceType === 'email').connectionId).toBe(connected.connection.id);

    await request(app.getHttpServer()).post(`/api/plans/${installed.body.id}/status`).set(auth(user.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/plans/${installed.body.id}/versions/2/apply`)
      .set(auth(user.token))
      .expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${installed.body.id}/status`).set(auth(user.token)).send({ status: 'active' }).expect(201);

    const usage = await request(app.getHttpServer()).get(`/api/connections/${connected.connection.id}/plans`).set(auth(user.token)).expect(200);
    expect(usage.body).toEqual([
      expect.objectContaining({ planId: installed.body.id, planName: `等待邮箱连接-${unique}`, requiredCapabilities: expect.arrayContaining(['READ_EMAIL']) }),
    ]);

    await pool.query("UPDATE connections SET status='reauthorization_required', status_reason='refresh_required' WHERE id=UUID_TO_BIN(?)", [connected.connection.id]);
    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(today.body.connectionIssues).toEqual([
      expect.objectContaining({
        connectionId: connected.connection.id,
        connectionStatus: 'reauthorization_required',
        providerKey: 'gmail',
        planId: installed.body.id,
      }),
    ]);
  });
});
