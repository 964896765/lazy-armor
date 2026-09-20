import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOBILE_CANDIDATE_REGISTRY, resolveMobileCandidateSpec, type MobileObservationEnvelope } from '@lazy-armor/plan-schema';
import { MobileEvidenceService } from '../src/reality-pipeline/mobile-evidence.service';
import { MobileObservationService } from '../src/reality-pipeline/mobile-observation.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { bootP2App, register, type Session } from './p2-test-helpers';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('R2 unified mobile observation → candidate → truth', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let mobile: MobileObservationService;
  let pipeline: RealityPipelineService;
  let evidence: MobileEvidenceService;

  beforeAll(async () => {
    const booted = await bootP2App(`r2-mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    app = booted.app;
    pool = booted.pool;
    owner = await register(app, `r2-mobile-owner-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, 'Mobile Owner');
    stranger = await register(app, `r2-mobile-stranger-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, 'Mobile Stranger');
    mobile = app.get(MobileObservationService);
    pipeline = app.get(RealityPipelineService);
    evidence = app.get(MobileEvidenceService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  function envelope(candidateKind: string, payload: Record<string, unknown>, id = randomUUID()): MobileObservationEnvelope {
    const spec = resolveMobileCandidateSpec(candidateKind)!;
    return {
      sourceType: 'NOTIFICATION',
      packageName: 'com.example.mobile',
      candidateKind,
      parserId: spec.parserId,
      resourceHint: spec.resourceHint,
      observedAt: new Date().toISOString(),
      evidenceHash: digest(id),
      sourceRef: id,
      payload: { subjectKey: id, ...payload },
    };
  }

  const payloads: Array<[string, Record<string, unknown>, string]> = [
    ['transaction', { amountMinor: 12850, currency: 'CNY' }, 'finance.transaction.amount'],
    ['shipment', { status: 'IN_TRANSIT' }, 'shipment.status'],
    ['bill', { status: 'DUE' }, 'bill.bill.state'],
    ['account', { status: 'HEALTHY' }, 'digital_account.connection.health'],
    ['device', { status: 'ONLINE' }, 'device_status.status.state'],
  ];

  it('registers exactly the seven required mobile candidate kinds', () => {
    expect(MOBILE_CANDIDATE_REGISTRY.map((spec) => spec.candidateKind).sort()).toEqual(['account', 'bill', 'consumable', 'device', 'household_supply', 'shipment', 'transaction']);
  });

  it.each(payloads)('routes %s mobile evidence through observation → candidate → truth', async (candidateKind, payload, factKey) => {
    const ingested = await mobile.ingest(owner.userId, envelope(candidateKind, payload), 'android-mobile-observation', null);
    expect(ingested.duplicate).toBe(false);
    expect(ingested.candidates).toHaveLength(1);
    expect(ingested.candidates[0]).toMatchObject({ factKey, status: 'PENDING', truthRecordId: null });

    const truth = await pipeline.confirmCandidate(owner.userId, ingested.candidates[0].id);
    expect(truth.status).toBe('verified');
    expect(truth.currentVersion.versionNumber).toBe(1);
  });

  it('does not create duplicate truth for duplicate evidence', async () => {
    const id = randomUUID();
    const first = await mobile.ingest(owner.userId, envelope('transaction', { amountMinor: 1990, currency: 'CNY' }, id), 'android-mobile-observation', null);
    const second = await mobile.ingest(owner.userId, envelope('transaction', { amountMinor: 1990, currency: 'CNY' }, id), 'android-mobile-observation', null);
    expect(first.candidates[0].id).toBe(second.candidates[0].id);
    expect(second.duplicate).toBe(true);
    await pipeline.confirmCandidate(owner.userId, first.candidates[0].id);
    await pipeline.confirmCandidate(owner.userId, second.candidates[0].id);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM truth_records WHERE subject_key=?', [id]);
    expect(rows[0].total).toBe(1);
  });

  it('dedupes the same device and event into one observation', async () => {
    const id = randomUUID();
    const withDevice = { ...envelope('shipment', { status: 'IN_TRANSIT' }, id), deviceId: 'trusted-device-a' };
    const first = await mobile.ingest(owner.userId, withDevice, 'com.example.courier', null);
    const second = await mobile.ingest(owner.userId, withDevice, 'com.example.courier', null);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(first.observationId).toBe(second.observationId);
  });

  it('keeps two devices distinct even for the same event id', async () => {
    const id = randomUUID();
    const first = await mobile.ingest(owner.userId, { ...envelope('shipment', { status: 'IN_TRANSIT' }, id), deviceId: 'trusted-device-a' }, 'com.example.courier', null);
    const second = await mobile.ingest(owner.userId, { ...envelope('shipment', { status: 'IN_TRANSIT' }, id), deviceId: 'trusted-device-b' }, 'com.example.courier', null);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    expect(first.observationId).not.toBe(second.observationId);
  });

  it('fails closed on an unsupported candidate kind', async () => {
    const unsupported: MobileObservationEnvelope = {
      sourceType: 'NOTIFICATION',
      packageName: 'com.example.mobile',
      candidateKind: 'garbage',
      parserId: 'generic.device-status.v1',
      resourceHint: 'DeviceStatus',
      observedAt: new Date().toISOString(),
      evidenceHash: digest('garbage'),
      sourceRef: randomUUID(),
      payload: { status: 'X' },
    };
    await expect(mobile.ingest(owner.userId, unsupported, 'android-mobile-observation', null)).rejects.toThrow(/Unsupported mobile candidate kind/);
  });

  it('isolates candidates and truth from other users', async () => {
    const ingested = await mobile.ingest(owner.userId, envelope('device', { status: 'OFFLINE' }), 'android-mobile-observation', null);
    await expect(pipeline.confirmCandidate(stranger.userId, ingested.candidates[0].id)).rejects.toThrow(/not found/i);
  });

  it('exports sanitized evidence without leaking raw payload', async () => {
    const exported = await evidence.list(owner.userId);
    expect(exported.length).toBeGreaterThan(0);
    const entry = exported[0];
    expect(entry).toMatchObject({
      sourceType: expect.any(String),
      packageIdentity: 'com.example.mobile',
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      parserId: expect.any(String),
      resourceHint: expect.any(String),
      status: expect.stringMatching(/^(normalized|candidate_created|truth_verified|rejected)$/),
    });
    // Raw normalized payload (amount/currency/status) must not be exported.
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toMatch(/"amountMinor"|"currency"|"subjectKey"/);
    expect(exported.some((item) => item.status === 'truth_verified')).toBe(true);
    expect(exported.some((item) => item.truth !== null)).toBe(true);
  });
});
