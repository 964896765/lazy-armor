import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { bootP2App, register, auth, type Session } from './p2-test-helpers';

describe.sequential('P2-0 provider capability matrix', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`provider-matrix-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p2-provider-${unique}@example.com`, 'P2 Provider');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('exposes consumer-safe provider matrix in the public connectors API', async () => {
    const response = await request(app.getHttpServer()).get('/api/connectors').expect(200);
    expect(response.body.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
      'manual',
      'internal',
      'webhook',
      'gmail',
      'google_calendar',
      'file_provider',
      'logistics_provider',
      'content_provider',
    ]));
    const gmail = response.body.find((item: { key: string }) => item.key === 'gmail');
    expect(gmail).toMatchObject({
      providerType: 'email',
      productionStatus: 'BETA',
      authentication: { type: 'oauth2' },
      connectable: true,
    });
    expect(gmail.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'READ_EMAIL_METADATA', name: '读取邮件标题和时间', operation: 'read', requiresConfirmation: false }),
      expect.objectContaining({ key: 'CREATE_DRAFT', name: '准备邮件草稿', operation: 'execute', draftOnly: false }),
    ]));
    expect(JSON.stringify(gmail)).not.toContain('riskLevel');
    expect(JSON.stringify(gmail)).not.toContain('retrySafety');
  });

  it('exposes internal readiness only through the protected diagnostics endpoint', async () => {
    await request(app.getHttpServer()).get('/api/admin/diagnostics/connectors').expect(401);
    await request(app.getHttpServer()).get('/api/admin/diagnostics/connectors').set(auth(user.token)).expect(403);
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', user.userId]);
    const response = await request(app.getHttpServer())
      .get('/api/admin/diagnostics/connectors')
      .set(auth(user.token))
      .expect(200);
    const gmail = response.body.find((item: { key: string }) => item.key === 'gmail');
    expect(gmail.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'READ_EMAIL',
        riskLevel: 'R0',
        requiredPermission: 'READ_EMAIL',
        providerAvailability: 'beta',
      }),
      expect.objectContaining({
        key: 'CREATE_DRAFT',
        riskLevel: 'R2',
        sideEffectContract: expect.objectContaining({
          sideEffect: true,
          retrySafety: 'ambiguous',
        }),
      }),
    ]));
    const calendar = response.body.find((item: { key: string }) => item.key === 'google_calendar');
    expect(calendar).toMatchObject({
      providerType: 'calendar',
      productionStatus: 'BETA',
      supportsRefresh: true,
      supportsRevoke: true,
    });
    expect(calendar.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'READ_EVENT', riskLevel: 'R0', providerAvailability: 'beta' }),
      expect.objectContaining({ key: 'CREATE_EVENT', riskLevel: 'R3', providerAvailability: 'disabled' }),
      expect.objectContaining({ key: 'UPDATE_EVENT', riskLevel: 'R3', providerAvailability: 'disabled' }),
    ]));
    const content = response.body.find((item: { key: string }) => item.key === 'content_provider');
    expect(content.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'PUBLISH_CONTENT', providerAvailability: 'disabled' }),
      expect.objectContaining({ key: 'READ_ANALYTICS', providerAvailability: 'disabled' }),
    ]));
  });

  it('keeps connector catalog and capability rows synchronized in the database', async () => {
    const [providerRows] = await pool.query<any[]>("SELECT connector_key, provider_type, production_status, authentication_type FROM connectors WHERE connector_key IN ('gmail','google_calendar','content_provider') ORDER BY connector_key");
    expect(providerRows).toHaveLength(3);
    const [capabilityRows] = await pool.query<any[]>("SELECT capability_key, provider_availability, retry_safety FROM connector_capabilities cc JOIN connectors c ON c.id = cc.connector_id WHERE c.connector_key='gmail' ORDER BY capability_key");
    expect(capabilityRows.map((row) => row.capability_key)).toEqual(['CREATE_DRAFT', 'READ_EMAIL', 'READ_EMAIL_METADATA']);
    expect(capabilityRows.every((row) => typeof row.provider_availability === 'string' && typeof row.retry_safety === 'string')).toBe(true);
  });
});
