import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { auth, bootP2App, oauthConnect, register, type Session } from './p2-test-helpers';

describe.sequential('P2-4/5 logistics and content adapters', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let logisticsConnectionId: string;
  let contentConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`logistics-content-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p2-logistics-content-${unique}@example.com`, 'P2 Logistics Content');
    const logistics = await request(app.getHttpServer()).post('/api/connections').set(auth(user.token)).send({
      connectorId: 'logistics_provider', externalAccountName: '物流测试 Adapter', credentials: { apiKey: 'test-only' },
    }).expect(201);
    logisticsConnectionId = logistics.body.id as string;
    contentConnectionId = (await oauthConnect(app, user.token, 'content_provider', 'content-test')).connection.id as string;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('normalizes provider-specific logistics fixtures and never leaks provider fields', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/connections/${logisticsConnectionId}/invoke`).set(auth(user.token)).send({
        capability: 'READ_TRACKING', requestId: `tracking-${unique}`, input: {
          testMode: true, provider: 'sf_test',
          payload: { waybillNo: 'SF10001', opCode: '80', opDesc: '已签收', opTime: '2026-09-02T08:00:00.000Z' },
        },
      }).expect(201);
    expect(response.body).toEqual({
      trackingNumber: 'SF10001', carrier: 'SF', state: 'delivered', latestEvent: '已签收',
      lastUpdatedAt: '2026-09-02T08:00:00.000Z', deliveredAt: '2026-09-02T08:00:00.000Z',
    });
    expect(JSON.stringify(response.body)).not.toContain('waybillNo');
    expect(JSON.stringify(response.body)).not.toContain('opCode');
  });

  it('keeps real logistics disabled without a provider gate', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/connections/${logisticsConnectionId}/invoke`).set(auth(user.token)).send({
        capability: 'READ_TRACKING', requestId: `tracking-prod-${unique}`, input: { trackingNumber: 'SF10001' },
      }).expect(400);
    expect(response.body).toMatchObject({ category: 'PROVIDER_UNAVAILABLE' });
  });

  it('reads content and prepares drafts while publish remains disabled', async () => {
    const read = await request(app.getHttpServer())
      .post(`/api/connections/${contentConnectionId}/invoke`).set(auth(user.token)).send({
        capability: 'READ_CONTENT', requestId: `content-read-${unique}`, input: { items: [{ title: '主内容', body: '正文' }] },
      }).expect(201);
    expect(read.body.items[0]).toMatchObject({ title: '主内容', body: '正文' });

    const draft = await request(app.getHttpServer())
      .post(`/api/connections/${contentConnectionId}/invoke`).set(auth(user.token)).send({
        capability: 'CREATE_DRAFT', requestId: `content-draft-${unique}`, input: { title: '平台草稿' },
      }).expect(201);
    expect(draft.body).toMatchObject({ title: '平台草稿', status: 'draft', published: false });

    await request(app.getHttpServer())
      .post(`/api/connections/${contentConnectionId}/invoke`).set(auth(user.token)).send({
        capability: 'PUBLISH_CONTENT', requestId: `content-publish-${unique}`, idempotencyKey: `publish-${unique}`, input: { title: '禁止发布' },
      }).expect(403);
    const matrix = await request(app.getHttpServer()).get('/api/connectors/content_provider').expect(200);
    expect(matrix.body).toMatchObject({ productionStatus: 'DRAFT_ONLY', draftOnly: true });
    expect(matrix.body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'PUBLISH_CONTENT', draftOnly: true }),
    ]));
  });

  it('rejects legacy direct credential submission for every OAuth provider', async () => {
    await request(app.getHttpServer()).post('/api/connections').set(auth(user.token)).send({
      connectorId: 'gmail', externalAccountName: 'bypass-attempt', credentials: { accessToken: 'client-supplied' },
    }).expect(400);
  });
});
