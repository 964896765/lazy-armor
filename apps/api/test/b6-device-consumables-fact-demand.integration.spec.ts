import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { ExecutionWorker } from '../src/execution/execution-worker.service';

/**
 * device.consumables 金标准场景 —— 有效数据获取。
 * 复用第三批 Source Resolver / Reality Pipeline / FactDemandResolver，验证：
 *   1) 没有真实数据时不得推断耗材剩余寿命（NEEDS_SOURCE，绝不虚构设备实时读取）；
 *   2) 只有取得可验证事实后才 SATISFIED；
 *   3) 事实按用户与 ResourceSubject 严格隔离。
 */
describe.sequential('B6 device.consumables FactDemand source resolution', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let worker: ExecutionWorker;
  let consumableId: string;
  let subjectKey: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = () => ({
    scenarioKey: 'device.consumables',
    scenarioRevision: 2,
    goal: { intent: 'NOTIFY_ON_CONSUMABLE_DUE', description: '耗材需要更换时提醒', constraints: {} },
    subject: { resourceType: 'device.consumable', subjectKey },
  });

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`b6-consumables-fd-${unique}`));
    owner = await register(app, `b6-fd-owner-${unique}@example.com`, 'Consumable owner');
    stranger = await register(app, `b6-fd-stranger-${unique}@example.com`, 'Consumable stranger');
    worker = app.get(ExecutionWorker);
    const profile = await request(app.getHttpServer()).post('/api/device-profiles').set(auth(owner.token)).send({
      type: '净水器', brand: '测试品牌', model: `B6-${unique}`, purchasedAt: '2026-01-01T00:00:00.000Z',
      maintenanceIntervalDays: 180, sourceType: 'manual',
    }).expect(201);
    const consumable = await request(app.getHttpServer()).post('/api/device-consumables').set(auth(owner.token)).send({
      deviceProfileId: profile.body.id, name: '前置滤芯', lastReplacedAt: '2026-09-01T00:00:00.000Z',
      replacementIntervalDays: 90, remindBeforeDays: 14,
    }).expect(201);
    consumableId = consumable.body.id;
    subjectKey = `device.consumable:${consumableId}`;
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('rejects a subject type the contract does not allow', async () => {
    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token))
      .send({ ...body(), subject: { resourceType: 'shipment', subjectKey } }).expect(400);
  });

  it('reports an explicit manual-registration step without guessing remaining life', async () => {
    const response = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body()).expect(201);
    expect(response.body.demands).toEqual([expect.objectContaining({
      factKey: 'device.consumable.remaining_days', state: 'NEEDS_MANUAL_INPUT',
      capabilityDiscovered: false, dataActuallyAcquired: false, dataVerified: false, sourceCurrentlyUsable: false,
    })]);
    expect(response.body.demands[0].candidateSources).toEqual([expect.objectContaining({
      kind: 'MANUAL_INPUT', usable: false, truthRecordId: null, truthVersionId: null,
      reasonCodes: ['MANUAL_INPUT_REQUIRED'],
    })]);
  });

  it('persists a typed MANUAL source through Offer selection and isolates it per user', async () => {
    const unavailable = await request(app.getHttpServer()).post('/api/planning/offers/v2').set(auth(owner.token)).send(body()).expect(201);
    expect(unavailable.body.status).toBe('UNAVAILABLE');

    const observedAt = new Date().toISOString();
    const manualRequest = {
      idempotencyKey: `manual-${unique}`,
      parserKey: 'generic.consumable-remaining.v1', resourceHint: 'device.consumable',
      payload: { subjectKey, remainingDays: 12, consumableType: '前置滤芯' },
      observedAt,
    };
    const ingested = await request(app.getHttpServer()).post('/api/manual-facts').set(auth(owner.token)).send(manualRequest).expect(201);
    const duplicate = await request(app.getHttpServer()).post('/api/manual-facts').set(auth(owner.token)).send(manualRequest).expect(201);
    expect(duplicate.body).toMatchObject({ observationId: ingested.body.observationId, duplicate: true });
    expect(ingested.body.candidates[0]?.factKey).toBe('device.consumable.remaining_days');
    await request(app.getHttpServer()).post(`/api/candidates/${ingested.body.candidates[0]!.id}/confirm`)
      .set(auth(owner.token)).send({}).expect(201);

    const ownerResult = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body()).expect(201);
    expect(ownerResult.body.demands[0]).toMatchObject({ state: 'SATISFIED', sourceCurrentlyUsable: true,
      dataActuallyAcquired: true, dataVerified: true, selectedSource: { kind: 'MANUAL_INPUT' } });
    expect(ownerResult.body.demands[0].selectedSource.truthRecordId).toBeTruthy();
    expect(ownerResult.body.demands[0].selectedSource.truthVersionId).toBeTruthy();

    const offer = await request(app.getHttpServer()).post('/api/planning/offers/v2').set(auth(owner.token)).send(body()).expect(201);
    expect(offer.body).toMatchObject({ status: 'AVAILABLE', offer: { contractVersion: 2 } });
    expect(offer.body.offer.sourceSelections[0]).toMatchObject({
      factKey: 'device.consumable.remaining_days', subjectKey, selection: { kind: 'MANUAL_INPUT' },
    });
    const chosen = await request(app.getHttpServer()).post(`/api/planning/offers/${offer.body.id}/choose`).set(auth(owner.token))
      .send({ idempotencyKey: `choose-${unique}` }).expect(201);
    const availability = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(availability.body.assessment).toMatchObject({ state: 'CURRENT' });

    await request(app.getHttpServer()).post(`/api/plans/${chosen.body.planId}/status`).set(auth(owner.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${chosen.body.planId}/versions/1/apply`).set(auth(owner.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${chosen.body.planId}/status`).set(auth(owner.token)).send({ status: 'active' }).expect(201);
    const [bindingRows] = await pool.query('SELECT BIN_TO_UUID(id) id FROM strategy_runtime_bindings WHERE plan_version_id=UUID_TO_BIN(?)',
      [chosen.body.planVersionId]) as [{ id: string }[], unknown];
    const scheduled = await request(app.getHttpServer()).post(`/api/strategy-runtime/bindings/${bindingRows[0]!.id}/schedule`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(scheduled.body.subjectKey).toBe(subjectKey);
    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${scheduled.body.id}/evaluate`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(evaluated.body).toMatchObject({ result: 'READY_FOR_PLAN_ENGINE' });
    const handedOff = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${scheduled.body.id}/handoff`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(handedOff.body.status).toBe('DISPATCHED');
    await worker.processExecution(handedOff.body.executionId);
    const execution = await request(app.getHttpServer()).get(`/api/executions/${handedOff.body.executionId}`)
      .set(auth(owner.token)).expect(200);
    expect(execution.body).toMatchObject({ status: 'succeeded', outcome: { outcome: 'SUCCESS' } });
    expect(execution.body.steps.find((step: { actionType: string }) => step.actionType === 'notify')?.outputSnapshotJson)
      .toMatchObject({ notified: true });
    const lifecycle = await request(app.getHttpServer()).get(`/api/plans/${chosen.body.planId}/lifecycle-projection`)
      .set(auth(owner.token)).expect(200);
    const lifecycleStep = (key: string) => lifecycle.body.steps.find((step: { key: string }) => step.key === key);
    expect(lifecycleStep('EXECUTION').state).toBe('COMPLETED');
    expect(lifecycleStep('VERIFICATION').state).toBe('COMPLETED');
    expect(lifecycleStep('TODAY_RECORDS').state).toBe('COMPLETED');
    const [unchanged] = await pool.query('SELECT last_replaced_at FROM device_consumables WHERE id=UUID_TO_BIN(?)', [consumableId]) as [{ last_replaced_at: Date }[], unknown];
    expect(unchanged[0]!.last_replaced_at.toISOString()).toContain('2026-09-01');

    const truthVersionId = ownerResult.body.demands[0].selectedSource.truthVersionId;
    await pool.query('UPDATE truth_record_versions SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 DAY) WHERE id=UUID_TO_BIN(?)', [truthVersionId]);
    const stale = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(stale.body.assessment).toMatchObject({ state: 'REFRESH_REQUIRED' });
    const staleReplacement = await request(app.getHttpServer()).post(`/api/planning/offers/plans/${chosen.body.planId}/replan`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(staleReplacement.body.replacementOffer.status).toBe('UNAVAILABLE');
    await pool.query('UPDATE truth_record_versions SET created_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [truthVersionId]);

    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(stranger.token)).send(body()).expect(400);

    await pool.query('UPDATE truth_records SET revoked_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)',
      [ownerResult.body.demands[0].selectedSource.truthRecordId]);
    const revoked = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`)
      .set(auth(owner.token)).expect(200);
    expect(revoked.body.assessment).toMatchObject({ state: 'RECONFIRMATION_REQUIRED' });
    const replacement = await request(app.getHttpServer()).post(`/api/planning/offers/plans/${chosen.body.planId}/replan`)
      .set(auth(owner.token)).send({}).expect(201);
    expect(replacement.body.replacementOffer.status).toBe('UNAVAILABLE');
  });
});
