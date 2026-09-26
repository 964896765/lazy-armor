import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('CreationDraft persistence and resume assessment', { timeout: 90_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const trustedDeviceId = randomUUID();
  const appConnectionId = randomUUID();
  const scenarioKey = 'daily_life.delivery';
  const goal = { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '物流变化时提醒', constraints: {} };
  const subject = { resourceType: 'shipment', subjectKey: `shipment:${unique}`, displayName: '我的包裹' };

  let draftId = '';
  let version = 0;
  let demandId = '';
  let deviceSourceId = '';

  const save = (payload: Record<string, unknown>, expected = 201) =>
    request(app.getHttpServer()).post('/api/creation-drafts').set(auth(owner.token)).send(payload).expect(expected);
  const resume = () => request(app.getHttpServer()).post(`/api/creation-drafts/${draftId}/resume`).set(auth(owner.token));

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`creation-draft-${unique}`));
    owner = await register(app, `cd-owner-${unique}@example.com`, 'Draft owner');
    stranger = await register(app, `cd-stranger-${unique}@example.com`, 'Draft stranger');
    await pool.query(
      `INSERT INTO trusted_devices(id,user_id,device_id,key_id,public_key_spki,public_key_fingerprint,trust_level,status,last_proved_at,created_at,updated_at)
       VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,'key-cd','test-spki',?,'verified','active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [trustedDeviceId, owner.userId, `device-${unique}`, `cd-${unique}`],
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

  async function freshHeartbeat() {
    await pool.query(
      "UPDATE device_heartbeats SET online_state='online',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)",
      [trustedDeviceId],
    );
  }

  async function resolveSources() {
    await freshHeartbeat();
    const response = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token))
      .send({ scenarioKey, scenarioRevision: 2, goal, subject }).expect(201);
    const demand = (response.body.demands as Array<{ demandId: string; candidateSources: Array<{ kind: string; sourceId: string }> }>)[0];
    demandId = demand.demandId;
    deviceSourceId = demand.candidateSources.find((candidate) => candidate.kind === 'TRUSTED_DEVICE')!.sourceId;
  }

  it('saves a stage-1 goal-only draft and isolates it by user', async () => {
    const response = await save({ scenarioKey, scenarioRevision: 2, stage: 1, goal, subject: null });
    draftId = response.body.draftId as string;
    version = response.body.version as number;
    expect(response.body).toMatchObject({ state: 'ACTIVE', stage: 1, version: 1, sourceChoices: [], subject: null });
    expect(response.body.draftId).toBeTruthy();

    const listed = await request(app.getHttpServer()).get('/api/creation-drafts').set(auth(owner.token)).expect(200);
    expect(listed.body).toContainEqual(expect.objectContaining({ draftId }));

    await request(app.getHttpServer()).get(`/api/creation-drafts/${draftId}`).set(auth(stranger.token)).expect(404);
    const strangerList = await request(app.getHttpServer()).get('/api/creation-drafts').set(auth(stranger.token)).expect(200);
    expect(strangerList.body).toEqual([]);
  });

  it('resumes with NEEDS_SUBJECT when no subject has been chosen', async () => {
    const assessment = await resume().expect(201);
    expect(assessment.body).toMatchObject({ state: 'NEEDS_SUBJECT', draftId });
  });

  it('upserts idempotently by scenario and enforces optimistic versioning', async () => {
    const payload = { scenarioKey, scenarioRevision: 2, stage: 2, goal, subject };
    const upserted = await save(payload);
    expect(upserted.body.draftId).toBe(draftId);
    expect(upserted.body.version).toBe(version + 1);
    version = upserted.body.version as number;

    await save({ ...payload, version: 99 }, 409);
    const reconciled = await save({ ...payload, version });
    expect(reconciled.body.version).toBe(version + 1);
    version = reconciled.body.version as number;
  });

  it('rejects fabricated sources and persists only server-validated selections', async () => {
    await resolveSources();
    const stage3 = { scenarioKey, scenarioRevision: 2, stage: 3, goal, subject };

    await save({ ...stage3, sourceChoices: [{ demandId: 'fd_fake', sourceId: 'connection:fake:cap' }] }, 400);
    await save({ ...stage3, sourceChoices: [{ demandId, sourceId: 'connection:fake:cap' }] }, 400);

    const saved = await save({ ...stage3, sourceChoices: [{ demandId, sourceId: deviceSourceId }] });
    version = saved.body.version as number;
    expect(saved.body.sourceChoices[0]).toMatchObject({ demandId, factKey: 'shipment.status', subjectKey: subject.subjectKey });
    expect(saved.body.sourceChoices[0].selection).toMatchObject({ kind: 'TRUSTED_DEVICE', sourceId: deviceSourceId, deviceAppConnectionId: appConnectionId });
  });

  it('resumes with READY when sources are still fresh and no offer is selected', async () => {
    const assessment = await resume().expect(201);
    expect(assessment.body).toMatchObject({ state: 'READY', selectedOfferKey: null });
  });

  it('requires offer regeneration when the selected offer is missing or expired', async () => {
    await save({ scenarioKey, scenarioRevision: 2, stage: 4, goal, subject,
      sourceChoices: [{ demandId, sourceId: deviceSourceId }], selectedOfferKey: 'po_missing_offer' });
    const assessment = await resume().expect(201);
    expect(assessment.body).toMatchObject({ state: 'NEEDS_OFFER_REGENERATION' });
    expect(assessment.body.reasonCodes).toContain('OFFER_EXPIRED');
  });

  it('requires source review after the device source goes offline', async () => {
    await freshHeartbeat();
    await save({ scenarioKey, scenarioRevision: 2, stage: 3, goal, subject,
      sourceChoices: [{ demandId, sourceId: deviceSourceId }] });
    await pool.query("UPDATE device_heartbeats SET online_state='offline' WHERE trusted_device_id=UUID_TO_BIN(?)", [trustedDeviceId]);
    const assessment = await resume().expect(201);
    expect(assessment.body.state).toBe('NEEDS_SOURCE_REVIEW');
    await freshHeartbeat();
  });

  it('requires reconfirmation after the scenario contract revision drifts', async () => {
    await pool.query('UPDATE creation_drafts SET scenario_revision=999 WHERE draft_id=UUID_TO_BIN(?)', [draftId]);
    const assessment = await resume().expect(201);
    expect(assessment.body).toMatchObject({ state: 'NEEDS_RECONFIRMATION' });
    expect(assessment.body.reasonCodes).toContain('SCENARIO_CONTRACT_CHANGED');
    await pool.query('UPDATE creation_drafts SET scenario_revision=2 WHERE draft_id=UUID_TO_BIN(?)', [draftId]);
  });

  it('discards the draft and removes it from the active list', async () => {
    const discarded = await request(app.getHttpServer()).delete(`/api/creation-drafts/${draftId}`)
      .set(auth(owner.token)).expect(200);
    expect(discarded.body.state).toBe('DISCARDED');

    await resume().expect(409);
    await request(app.getHttpServer()).delete(`/api/creation-drafts/${draftId}`).set(auth(stranger.token)).expect(404);

    const listed = await request(app.getHttpServer()).get('/api/creation-drafts').set(auth(owner.token)).expect(200);
    expect(listed.body).not.toContainEqual(expect.objectContaining({ draftId }));
  });
});
