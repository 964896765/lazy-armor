import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const evidence = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('runtime productization batch 3 reality pipeline', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`reality-pipeline-${unique}`));
    owner = await register(app, `reality-owner-${unique}@example.com`, 'Reality Owner');
    stranger = await register(app, `reality-stranger-${unique}@example.com`, 'Reality Stranger');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('persists immutable parser, normalizer and policy registries', async () => {
    const [[adapters], [policies]] = await Promise.all([
      pool.query<RowDataPacket[]>('SELECT adapter_kind, COUNT(*) total FROM reality_adapter_definitions GROUP BY adapter_kind'),
      pool.query<RowDataPacket[]>('SELECT policy_kind, COUNT(*) total FROM reality_policy_definitions GROUP BY policy_kind'),
    ]);
    expect(adapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter_kind: 'PARSER', total: 5 }),
      expect.objectContaining({ adapter_kind: 'NORMALIZER', total: 4 }),
    ]));
    expect(policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ policy_kind: 'DEDUPE', total: 1 }),
      expect.objectContaining({ policy_kind: 'FRESHNESS', total: 4 }),
      expect.objectContaining({ policy_kind: 'CONFLICT', total: 1 }),
    ]));
  });

  it('exposes a protected ingestion contract and owner-scoped candidate decisions', async () => {
    const body = {
      sourceMode: 'OFFICIAL_API', providerKey: 'manual', externalEventKey: `transaction-${unique}`,
      parserKey: 'generic.transaction.v1', resourceHint: 'finance.transaction',
      payload: { subjectKey: `purchase-${unique}`, amountMinor: 25800, currency: 'CNY' },
      evidenceHash: evidence(`transaction-${unique}`), observedAt: '2026-09-09T01:00:00.000Z', occurredAt: '2026-09-09T00:59:00.000Z',
    };
    await request(app.getHttpServer()).post('/api/source-observations').send(body).expect(401);
    await request(app.getHttpServer()).post('/api/source-observations').set(auth(owner.token)).send(body).expect(403);
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['super_admin', owner.userId]);
    const created = await request(app.getHttpServer()).post('/api/source-observations').set(auth(owner.token)).send(body).expect(201);
    expect(created.body).toMatchObject({ duplicate: false, candidates: [expect.objectContaining({ resourceType: 'finance.transaction', factKey: 'finance.transaction.amount', status: 'PENDING' })] });

    const candidateId = created.body.candidates[0].id as string;
    await request(app.getHttpServer()).post(`/api/candidates/${candidateId}/confirm`).set(auth(stranger.token)).expect(404);
    const confirmed = await request(app.getHttpServer()).post(`/api/candidates/${candidateId}/confirm`).set(auth(owner.token)).expect(201);
    expect(confirmed.body).toMatchObject({ status: 'verified', currentVersion: { versionNumber: 1 }, provenance: [expect.objectContaining({ providerKey: 'manual', sourceMode: 'OFFICIAL_API' })] });
    await request(app.getHttpServer()).get(`/api/truth/${confirmed.body.id}`).set(auth(stranger.token)).expect(404);
    const truth = await request(app.getHttpServer()).get('/api/truth').set(auth(owner.token)).expect(200);
    expect(truth.body.some((item: { id: string }) => item.id === confirmed.body.id)).toBe(true);
  });

  it('normalizes transaction, shipment and connection resources through one pipeline', async () => {
    const cases = [
      { parserKey: 'generic.transaction.v1', resourceHint: 'finance.transaction', subjectKey: `tx-${unique}`, payload: { amountMinor: 1990, currency: 'CNY' }, factKey: 'finance.transaction.amount' },
      { parserKey: 'generic.shipment-status.v1', resourceHint: 'shipment', subjectKey: `shipment-${unique}`, payload: { status: 'IN_TRANSIT' }, factKey: 'shipment.status' },
      { parserKey: 'generic.connection-health.v1', resourceHint: 'digital_account.connection', subjectKey: `connection-${unique}`, payload: { status: 'HEALTHY' }, factKey: 'digital_account.connection.health' },
    ] as const;
    for (const item of cases) {
      const result = await pipeline.ingest(owner.userId, {
        sourceMode: 'INTERNAL', providerKey: 'runtime-test', externalEventKey: item.subjectKey,
        parserKey: item.parserKey, resourceHint: item.resourceHint,
        payload: { subjectKey: item.subjectKey, ...item.payload }, evidenceHash: evidence(item.subjectKey), observedAt: '2026-09-09T02:00:00.000Z',
      });
      expect(result.candidates[0]).toMatchObject({ factKey: item.factKey, status: 'PENDING' });
    }
  });

  it('deduplicates concurrent observations and fails closed on identity conflicts', async () => {
    const externalEventKey = `concurrent-${randomUUID()}`;
    const input = {
      sourceMode: 'WEBHOOK' as const, providerKey: 'shipping-test', externalEventKey,
      parserKey: 'generic.shipment-status.v1' as const, resourceHint: 'shipment',
      payload: { subjectKey: `parcel-${unique}`, status: 'DELIVERED' }, evidenceHash: evidence(externalEventKey), observedAt: '2026-09-09T03:00:00.000Z',
    };
    const results = await Promise.all([pipeline.ingest(owner.userId, input), pipeline.ingest(owner.userId, input), pipeline.ingest(owner.userId, input)]);
    expect(new Set(results.map((item) => item.observationId))).toHaveLength(1);
    expect(new Set(results.map((item) => item.candidates[0]?.id))).toHaveLength(1);
    expect(results.filter((item) => item.duplicate)).toHaveLength(2);
    await expect(pipeline.ingest(owner.userId, { ...input, payload: { ...input.payload, status: 'LOST' } })).rejects.toThrow(/different evidence/);
  });

  it('creates one truth/version/provenance under concurrent confirmation', async () => {
    const key = `confirm-${randomUUID()}`;
    const ingested = await pipeline.ingest(owner.userId, {
      sourceMode: 'SHARE', providerKey: 'share-receiver', externalEventKey: key,
      parserKey: 'generic.connection-health.v1', resourceHint: 'digital_account.connection',
      payload: { subjectKey: key, status: 'DEGRADED' }, evidenceHash: evidence(key), observedAt: '2026-09-09T04:00:00.000Z',
    });
    const candidateId = ingested.candidates[0]!.id;
    const results = await Promise.all([pipeline.confirmCandidate(owner.userId, candidateId), pipeline.confirmCandidate(owner.userId, candidateId)]);
    expect(new Set(results.map((item) => item.id))).toHaveLength(1);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT r.id) records, COUNT(DISTINCT v.id) versions, COUNT(DISTINCT p.id) provenance
         FROM candidate_facts c
         LEFT JOIN truth_records r ON r.id=c.truth_record_id
         LEFT JOIN truth_record_versions v ON v.truth_record_id=r.id
         LEFT JOIN truth_provenance p ON p.candidate_fact_id=c.id
        WHERE c.id=UUID_TO_BIN(?)`,
      [candidateId],
    );
    expect(rows[0]).toMatchObject({ records: 1, versions: 1, provenance: 1 });
  });
});
