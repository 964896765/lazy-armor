import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('runtime productization batch 1 capability foundation', () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let connectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`capability-foundation-${unique}`);
    app = booted.app;
    pool = booted.pool;
    owner = await register(app, `capability-owner-${unique}@example.com`, 'Capability Owner');
    stranger = await register(app, `capability-stranger-${unique}@example.com`, 'Capability Stranger');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('persists exactly 18 immutable active provider manifest revisions', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT provider_key, revision, manifest_hash, status FROM provider_capability_manifests WHERE status='ACTIVE' ORDER BY provider_key",
    );
    expect(rows).toHaveLength(18);
    expect(new Set(rows.map((row) => row.provider_key)).size).toBe(18);
    expect(rows.every((row) => row.revision === 1 && /^[a-f0-9]{64}$/.test(row.manifest_hash))).toBe(true);
  });

  it('keeps the internal manifest surface protected by an operations role', async () => {
    await request(app.getHttpServer()).get('/api/provider-capabilities').expect(401);
    await request(app.getHttpServer()).get('/api/provider-capabilities').set(auth(owner.token)).expect(403);
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', owner.userId]);
    const response = await request(app.getHttpServer()).get('/api/provider-capabilities').set(auth(owner.token)).expect(200);
    expect(response.body).toHaveLength(18);
    expect(response.body.find((item: { providerKey: string }) => item.providerKey === 'gmail')).toMatchObject({
      revision: 1,
      providerReview: 'TO_VERIFY_OFFICIAL',
      capabilities: [expect.objectContaining({ officialAvailability: 'TO_VERIFY_OFFICIAL', implementationStatus: 'NOT_IMPLEMENTED' })],
    });
  });

  it('dual-writes grants and resolves the four dimensions without claiming unverified support', async () => {
    connectionId = (await request(app.getHttpServer())
      .post('/api/connections')
      .set(auth(owner.token))
      .send({ connectorId: 'manual', externalAccountName: 'Batch 1 manual source' })
      .expect(201)).body.id;

    await request(app.getHttpServer())
      .put(`/api/connections/${connectionId}/permissions`)
      .set(auth(owner.token))
      .send({ permissions: [{ capability: 'MANUAL_INPUT', granted: true }] })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/api/connections/${connectionId}/capabilities`)
      .set(auth(owner.token))
      .expect(200);
    expect(response.body.capabilities).toContainEqual(expect.objectContaining({
      key: 'MANUAL_INPUT',
      providerAvailability: 'TO_VERIFY_OFFICIAL',
      implementation: 'PRODUCTION',
      grant: 'GRANTED',
      health: 'HEALTHY',
      usable: false,
      reasons: expect.arrayContaining(['PROVIDER_OFFICIAL_STATUS_UNVERIFIED']),
    }));

    const [grants] = await pool.query<RowDataPacket[]>(
      'SELECT provider_key, capability_key, status, source FROM connection_capability_grants WHERE connection_id=UUID_TO_BIN(?)',
      [connectionId],
    );
    expect(grants).toContainEqual(expect.objectContaining({ provider_key: 'manual', capability_key: 'MANUAL_INPUT', status: 'GRANTED' }));
  });

  it('projects validation health per capability and enforces owner isolation', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/validate`).set(auth(owner.token)).expect(201);
    const [health] = await pool.query<RowDataPacket[]>(
      'SELECT provider_key, capability_key, status FROM provider_capability_health WHERE connection_id=UUID_TO_BIN(?)',
      [connectionId],
    );
    expect(health).toContainEqual(expect.objectContaining({ provider_key: 'manual', capability_key: 'MANUAL_INPUT', status: 'HEALTHY' }));
    await request(app.getHttpServer()).get(`/api/connections/${connectionId}/capabilities`).set(auth(stranger.token)).expect(404);
  });

  it('fails closed immediately when an existing permission is revoked', async () => {
    await request(app.getHttpServer())
      .put(`/api/connections/${connectionId}/permissions`)
      .set(auth(owner.token))
      .send({ permissions: [{ capability: 'MANUAL_INPUT', granted: false }] })
      .expect(200);
    const response = await request(app.getHttpServer())
      .get(`/api/connections/${connectionId}/capabilities`)
      .set(auth(owner.token))
      .expect(200);
    expect(response.body.capabilities).toContainEqual(expect.objectContaining({
      key: 'MANUAL_INPUT',
      grant: 'REVOKED',
      usable: false,
      reasons: expect.arrayContaining(['CAPABILITY_GRANT_REVOKED']),
    }));
  });
});
