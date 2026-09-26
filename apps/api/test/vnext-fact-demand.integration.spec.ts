import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('VNext FactDemand and user-scoped Source Resolver', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const subjectKey = `shipment:${unique}`;
  const trustedDeviceId = randomUUID();
  const appConnectionId = randomUUID();
  const body = {
    scenarioKey: 'daily_life.delivery',
    scenarioRevision: 2,
    goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '物流变化时提醒', constraints: {} },
    subject: { resourceType: 'shipment', subjectKey },
  };

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`vnext-fact-demand-${unique}`));
    owner = await register(app, `fd-owner-${unique}@example.com`, 'Fact owner');
    stranger = await register(app, `fd-stranger-${unique}@example.com`, 'Fact stranger');
    pipeline = app.get(RealityPipelineService);
    await pool.query(
      `INSERT INTO trusted_devices(id,user_id,device_id,key_id,public_key_spki,public_key_fingerprint,trust_level,status,last_proved_at,created_at,updated_at)
       VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,'key-vnext','test-spki',?,'verified','active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [trustedDeviceId, owner.userId, `device-${unique}`, hash(`device-${unique}`)],
    );
    await pool.query(
      `INSERT INTO device_app_connections(id,user_id,device_id,trusted_device_id,package_name,display_name,connection_type,launchable,enabled,modes_json,trust_level,last_seen_at,created_at,updated_at)
       VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,UUID_TO_BIN(?),'com.cainiao.wireless','菜鸟','mobile',1,1,JSON_ARRAY('notification_read'),'verified',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [appConnectionId, owner.userId, `device-${unique}`, trustedDeviceId],
    );
    await pool.query(
      `INSERT INTO device_heartbeats(id,user_id,trusted_device_id,device_id,online_state,last_heartbeat_at,created_at)
       VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'online',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [owner.userId, trustedDeviceId, `device-${unique}`],
    );
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('rejects unauthenticated, injected and invalid-object requests', async () => {
    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').send(body).expect(401);
    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token))
      .send({ ...body, factKey: 'finance.transaction.amount' }).expect(400);
    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token))
      .send({ ...body, subject: { resourceType: 'transaction', subjectKey } }).expect(400);
  });

  it('discovers an owned, authorized, online device source without pretending data was acquired', async () => {
    const response = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body).expect(201);
    expect(response.body.demands).toEqual([expect.objectContaining({
      factKey: 'shipment.status', state: 'PENDING_ACQUISITION', capabilityDiscovered: true,
      userOwnsSource: true, sourceCurrentlyUsable: true, dataActuallyAcquired: false, dataVerified: false,
    })]);
    expect(response.body.demands[0].candidateSources[0]).toMatchObject({
      kind: 'TRUSTED_DEVICE', providerKey: 'com.cainiao.wireless', sourceMode: 'NOTIFICATION', capabilityKey: 'READ_SHIPMENT',
      trustedDeviceId, deviceAppConnectionId: appConnectionId,
      discovered: true, ownedByUser: true, implemented: true, authorized: true, deviceOnline: true, usable: true,
    });
    expect(response.body.demands[0].selectedSource).toMatchObject({ kind: 'TRUSTED_DEVICE', trustedDeviceId,
      deviceAppConnectionId: appConnectionId });
  });

  it('isolates sources and Truth by user and exact ResourceSubject', async () => {
    const ingested = await pipeline.ingest(owner.userId, {
      sourceMode: 'NOTIFICATION', providerKey: 'com.cainiao.wireless', externalEventKey: `event-${unique}`,
      parserKey: 'generic.shipment-status.v1', resourceHint: 'shipment',
      payload: { subjectKey, status: 'IN_TRANSIT' }, evidenceHash: hash(`event-${unique}`), observedAt: new Date().toISOString(),
    });
    await pipeline.confirmCandidate(owner.userId, ingested.candidates[0]!.id, {
      verifiedBy: 'deterministic_test', verificationMethod: 'source_evidence',
    });

    const ownerResult = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body).expect(201);
    expect(ownerResult.body.demands[0]).toMatchObject({ state: 'SATISFIED', dataActuallyAcquired: true, dataVerified: true });

    const strangerResult = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(stranger.token)).send(body).expect(201);
    expect(strangerResult.body.demands[0]).toMatchObject({ state: 'NEEDS_SOURCE', dataActuallyAcquired: false, dataVerified: false });
  });

  it('reports authorization revocation and device offline independently from retained verified Truth', async () => {
    await pool.query('UPDATE device_app_connections SET enabled=0,modes_json=JSON_ARRAY(),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [appConnectionId]);
    await pool.query("UPDATE device_heartbeats SET online_state='offline',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)", [trustedDeviceId]);
    const response = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body).expect(201);
    expect(response.body.demands[0]).toMatchObject({
      state: 'SATISFIED', sourceCurrentlyUsable: true, dataActuallyAcquired: true, dataVerified: true,
      selectedSource: { kind: 'INTERNAL_FACT' },
    });
    expect(response.body.demands[0].candidateSources).toContainEqual(expect.objectContaining({
      kind: 'TRUSTED_DEVICE', authorized: false, deviceOnline: false, usable: false,
    }));
  });
});
