import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StrategyRuntimeService } from '../src/strategy-runtime/strategy-runtime.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('VNext persistent Plan Offer transaction', { timeout: 90_000 }, () => {
  let app: INestApplication; let pool: Pool; let owner: Session; let stranger: Session;
  let strategyRuntime: StrategyRuntimeService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = randomUUID(); const appId = randomUUID();

  const body = (suffix: string) => ({ scenarioKey: 'daily_life.delivery', scenarioRevision: 2,
    goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '物流变化时提醒', constraints: { quiet: true } },
    subject: { resourceType: 'shipment', subjectKey: `shipment:${unique}:${suffix}`, displayName: `包裹 ${suffix}` } });

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`vnext-offer-${unique}`));
    owner = await register(app, `offer-owner-${unique}@example.com`, 'Offer owner');
    stranger = await register(app, `offer-stranger-${unique}@example.com`, 'Offer stranger');
    strategyRuntime = app.get(StrategyRuntimeService);
    await pool.query(`INSERT INTO trusted_devices(id,user_id,device_id,key_id,public_key_spki,public_key_fingerprint,trust_level,status,last_proved_at,created_at,updated_at)
      VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,'key-offer','test-spki',?,'verified','active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
    [deviceId, owner.userId, `device-${unique}`, sha(unique)]);
    await pool.query(`INSERT INTO device_app_connections(id,user_id,device_id,trusted_device_id,package_name,display_name,connection_type,launchable,enabled,modes_json,trust_level,last_seen_at,created_at,updated_at)
      VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,UUID_TO_BIN(?),'com.cainiao.wireless','菜鸟','mobile',1,1,JSON_ARRAY('notification_read'),'verified',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
    [appId, owner.userId, `device-${unique}`, deviceId]);
    await pool.query(`INSERT INTO device_heartbeats(id,user_id,trusted_device_id,device_id,online_state,last_heartbeat_at,created_at)
      VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'online',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
    [owner.userId, deviceId, `device-${unique}`]);
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function freshHeartbeat() {
    await pool.query("UPDATE device_heartbeats SET online_state='online',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)", [deviceId]);
  }
  async function createOffer(suffix: string) {
    await freshHeartbeat();
    const response = await request(app.getHttpServer()).post('/api/planning/offers/v2').set(auth(owner.token)).send(body(suffix)).expect(201);
    expect(response.body.status).toBe('AVAILABLE');
    return response.body.id as string;
  }
  async function scalar(sql: string, params: unknown[] = []) {
    const [rows] = await pool.query(sql, params) as [{ value: number }[], unknown]; return Number(rows[0]?.value ?? 0);
  }

  it('isolates offers by user and atomically confirms one concurrent winner', async () => {
    const offerId = await createOffer('concurrent');
    await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(stranger.token))
      .send({ idempotencyKey: `stranger-${unique}` }).expect(404);
    const before = await scalar('SELECT COUNT(*) value FROM plans WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    const [left, right] = await Promise.all([
      request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token)).send({ idempotencyKey: `confirm-left-${unique}` }),
      request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token)).send({ idempotencyKey: `confirm-right-${unique}` }),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    expect(left.body.planId).toBe(right.body.planId);
    expect(await scalar('SELECT COUNT(*) value FROM plans WHERE user_id=UUID_TO_BIN(?)', [owner.userId])).toBe(before + 1);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offerId])).toBe(1);
    expect(await scalar(`SELECT COUNT(*) value FROM plan_versions pv JOIN plan_creation_contracts pc ON pc.plan_version_id=pv.id
      WHERE pc.offer_snapshot_id=UUID_TO_BIN(?)`, [offerId])).toBe(1);
    expect(await scalar(`SELECT COUNT(*) value FROM strategy_runtime_bindings b JOIN plan_creation_contracts pc ON pc.plan_version_id=b.plan_version_id
      WHERE pc.offer_snapshot_id=UUID_TO_BIN(?)`, [offerId])).toBe(1);
    const lifecycle = await request(app.getHttpServer()).get(`/api/plans/${left.body.planId}/lifecycle-projection`)
      .set(auth(owner.token)).expect(200);
    const step = (key: string) => lifecycle.body.steps.find((item: { key: string }) => item.key === key);
    expect(step('GOAL_OBJECT')).toMatchObject({ state: 'COMPLETED', reasonCode: 'GOAL_SPEC_AND_RESOURCE_SUBJECT_PERSISTED' });
    expect(step('USER_SELECTION')).toMatchObject({ state: 'COMPLETED', reasonCode: 'USER_OFFER_CONFIRMATION_PERSISTED' });
    expect(step('USER_PLAN')).toMatchObject({ state: 'COMPLETED', reasonCode: 'IMMUTABLE_PLAN_VERSION_PERSISTED' });
  });

  it('returns the existing authority record when success response was lost', async () => {
    const offerId = await createOffer('response-lost');
    const first = await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `lost-response-${unique}` }).expect(201);
    const retry = await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `lost-response-${unique}` }).expect(201);
    expect(retry.body).toMatchObject({ planId: first.body.planId, planVersionId: first.body.planVersionId, replayed: true });
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offerId])).toBe(1);
  });

  it('reassesses the exact Plan subject and requires a replacement Offer after device loss', async () => {
    const offerId = await createOffer('continuous-reassessment');
    const chosen = await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `continuous-${unique}` }).expect(201);
    const before = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(before.body.assessment).toMatchObject({ state: 'REFRESH_REQUIRED' });
    expect(before.body.subject.subjectKey).toBe(body('continuous-reassessment').subject.subjectKey);
    await pool.query("UPDATE plan_creation_contracts SET source_selection_json=JSON_REMOVE(source_selection_json,'$[0].selectedSource') WHERE plan_id=UUID_TO_BIN(?)", [chosen.body.planId]);
    const legacy = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(legacy.body.assessment).toMatchObject({ state: 'REFRESH_REQUIRED' });

    await pool.query("UPDATE device_heartbeats SET online_state='offline' WHERE trusted_device_id=UUID_TO_BIN(?)", [deviceId]);
    const unavailable = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(unavailable.body.assessment).toMatchObject({ state: 'RECONFIRMATION_REQUIRED' });
    expect(unavailable.body.assessment.reasonCodes).toContain('FACT_DEMAND_DEVICE_OFFLINE');
    const lifecycle = await request(app.getHttpServer()).get(`/api/plans/${chosen.body.planId}/lifecycle-projection`)
      .set(auth(owner.token)).expect(200);
    const step = (key: string) => lifecycle.body.steps.find((item: { key: string }) => item.key === key);
    expect(step('READINESS')).toMatchObject({ state: 'BLOCKED', reasonCode: 'FACT_DEMAND_DEVICE_OFFLINE' });
    expect(step('AVAILABILITY_RECONCILIATION')).toMatchObject({ state: 'BLOCKED' });

    const replacement = await request(app.getHttpServer()).post(`/api/planning/offers/plans/${chosen.body.planId}/replan`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(replacement.body).toMatchObject({
      availability: { state: 'RECONFIRMATION_REQUIRED' },
      replacementOffer: { status: 'UNAVAILABLE' },
    });
    expect(await scalar('SELECT COUNT(*) value FROM plan_versions WHERE plan_id=UUID_TO_BIN(?)', [chosen.body.planId])).toBe(1);
    await freshHeartbeat();
  });

  it('invalidates confirmation after authorization revocation and device offline', async () => {
    const revokedOffer = await createOffer('revoked');
    await pool.query('UPDATE device_app_connections SET enabled=0,modes_json=JSON_ARRAY(),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [appId]);
    await request(app.getHttpServer()).post(`/api/planning/offers/${revokedOffer}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `revoked-${unique}` }).expect(409);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [revokedOffer])).toBe(0);
    const [revokedRows] = await pool.query('SELECT status FROM plan_offer_snapshots WHERE id=UUID_TO_BIN(?)', [revokedOffer]) as [{ status: string }[], unknown];
    expect(revokedRows[0]?.status).toBe('INVALIDATED');
    await pool.query("UPDATE device_app_connections SET enabled=1,modes_json=JSON_ARRAY('notification_read'),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [appId]);
    const offlineOffer = await createOffer('offline');
    await pool.query("UPDATE device_heartbeats SET online_state='offline' WHERE trusted_device_id=UUID_TO_BIN(?)", [deviceId]);
    await request(app.getHttpServer()).post(`/api/planning/offers/${offlineOffer}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `offline-${unique}` }).expect(409);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offlineOffer])).toBe(0);
  });

  it('persists EXPIRED without creating plan authority', async () => {
    const offerId = await createOffer('expired');
    await pool.query('UPDATE plan_offer_snapshots SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [offerId]);
    await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `expired-${unique}` }).expect(409);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offerId])).toBe(0);
    const [rows] = await pool.query('SELECT status FROM plan_offer_snapshots WHERE id=UUID_TO_BIN(?)', [offerId]) as [{ status: string }[], unknown];
    expect(rows[0]?.status).toBe('EXPIRED');
  });

  it('invalidates a tampered immutable Scenario Contract snapshot', async () => {
    const offerId = await createOffer('contract-tamper');
    await pool.query('UPDATE plan_offer_snapshots SET contract_hash=? WHERE id=UUID_TO_BIN(?)', [sha(`tampered-${unique}`), offerId]);
    await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `tamper-${unique}` }).expect(409);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offerId])).toBe(0);
  });

  it('rolls back Plan, PlanVersion and contract when Strategy Binding fails', async () => {
    const offerId = await createOffer('rollback');
    const plansBefore = await scalar('SELECT COUNT(*) value FROM plans WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    const spy = vi.spyOn(strategyRuntime, 'bindInTransaction').mockRejectedValueOnce(new Error('injected binding failure'));
    await request(app.getHttpServer()).post(`/api/planning/offers/${offerId}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `rollback-${unique}` }).expect(500);
    spy.mockRestore();
    expect(await scalar('SELECT COUNT(*) value FROM plans WHERE user_id=UUID_TO_BIN(?)', [owner.userId])).toBe(plansBefore);
    expect(await scalar('SELECT COUNT(*) value FROM plan_creation_contracts WHERE offer_snapshot_id=UUID_TO_BIN(?)', [offerId])).toBe(0);
    const [rows] = await pool.query('SELECT status FROM plan_offer_snapshots WHERE id=UUID_TO_BIN(?)', [offerId]) as [{ status: string }[], unknown];
    expect(rows[0]?.status).toBe('AVAILABLE');
  });
});
