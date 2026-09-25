import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

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
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const subjectKey = `device.consumable:${unique}`;
  const body = {
    scenarioKey: 'device.consumables',
    scenarioRevision: 2,
    goal: { intent: 'NOTIFY_ON_CONSUMABLE_DUE', description: '耗材需要更换时提醒', constraints: {} },
    subject: { resourceType: 'device.consumable', subjectKey },
  };

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`b6-consumables-fd-${unique}`));
    owner = await register(app, `b6-fd-owner-${unique}@example.com`, 'Consumable owner');
    stranger = await register(app, `b6-fd-stranger-${unique}@example.com`, 'Consumable stranger');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('rejects a subject type the contract does not allow', async () => {
    await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token))
      .send({ ...body, subject: { resourceType: 'shipment', subjectKey } }).expect(400);
  });

  it('reports NEEDS_SOURCE without any acquired data (never guesses remaining life)', async () => {
    const response = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body).expect(201);
    expect(response.body.demands).toEqual([expect.objectContaining({
      factKey: 'device.consumable.remaining_days', state: 'NEEDS_SOURCE',
      capabilityDiscovered: false, dataActuallyAcquired: false, dataVerified: false, sourceCurrentlyUsable: false,
    })]);
  });

  it('resolves SATISFIED only after verified truth is acquired, isolated per user', async () => {
    const ingested = await pipeline.ingest(owner.userId, {
      sourceMode: 'INTERNAL', providerKey: 'edge-device', externalEventKey: `event-${unique}`,
      parserKey: 'generic.consumable-remaining.v1', resourceHint: 'device.consumable',
      payload: { subjectKey, remainingDays: 12, consumableType: '前置滤芯' },
      evidenceHash: hash(`event-${unique}`), observedAt: new Date().toISOString(),
    });
    expect(ingested.candidates[0]?.factKey).toBe('device.consumable.remaining_days');
    await pipeline.confirmCandidate(owner.userId, ingested.candidates[0]!.id, {
      verifiedBy: 'deterministic_test', verificationMethod: 'source_evidence',
    });

    const ownerResult = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(body).expect(201);
    expect(ownerResult.body.demands[0]).toMatchObject({ state: 'SATISFIED', dataActuallyAcquired: true, dataVerified: true });

    const strangerResult = await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(stranger.token)).send(body).expect(201);
    expect(strangerResult.body.demands[0]).toMatchObject({ state: 'NEEDS_SOURCE', dataActuallyAcquired: false, dataVerified: false });
  });
});
