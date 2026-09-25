import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('B7 finance.accounting persistent offer loop', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const subjectKey = `finance.transaction:local_file:txn-${unique}`;

  beforeAll(async () => {
    const booted = await bootP2App(`b7-acct-offer-${unique}`);
    app = booted.app;
    pool = booted.pool;
    owner = await register(app, `b7-acct-offer-${unique}@example.com`, 'B7 Acct Offer');
    stranger = await register(app, `b7-acct-offer-stranger-${unique}@example.com`, 'B7 Acct Stranger');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  const body = {
    scenarioKey: 'finance.accounting',
    scenarioRevision: 1,
    goal: { intent: 'SUMMARIZE_ACCOUNT_PERIOD', description: '账目整理', constraints: {} },
    subject: { resourceType: 'finance.transaction', subjectKey, displayName: '家庭账目' },
  };

  it('creates a persistent offer for finance.accounting and chooses it', async () => {
    const ingested = await pipeline.ingest(owner.userId, {
      sourceMode: 'FILE', providerKey: 'local_file', externalEventKey: `event-${unique}`,
      parserKey: 'generic.transaction.v1', resourceHint: 'finance.transaction',
      payload: { transactionId: `txn-${unique}`, amountMinor: 12850, currency: 'CNY', merchant: '测试商户', direction: 'DEBIT', transactionState: 'POSTED' },
      evidenceHash: hash(`event-${unique}`), observedAt: new Date().toISOString(),
    });
    await pipeline.confirmCandidate(owner.userId, ingested.candidates[0]!.id, {
      verifiedBy: 'deterministic_test', verificationMethod: 'source_evidence',
    });

    const offer = await request(app.getHttpServer()).post('/api/planning/offers/v2').set(auth(owner.token)).send(body).expect(201);
    expect(offer.body.status).toBe('AVAILABLE');

    const chosen = await request(app.getHttpServer()).post(`/api/planning/offers/${offer.body.id}/choose`).set(auth(owner.token)).send({ idempotencyKey: `choose-${unique}` }).expect(201);
    expect(chosen.body.planId).toBeTruthy();
    expect(chosen.body.planVersionId).toBeTruthy();

    const availability = await request(app.getHttpServer()).get(`/api/planning/offers/plans/${chosen.body.planId}/availability`).set(auth(owner.token)).expect(200);
    expect(availability.body.assessment.state).toBe('CURRENT');
  });

  it('isolates the offer from a stranger user', async () => {
    const offer = await request(app.getHttpServer()).post('/api/planning/offers/v2').set(auth(owner.token)).send(body).expect(201);
    await request(app.getHttpServer()).post(`/api/planning/offers/${offer.body.id}/choose`).set(auth(stranger.token)).send({ idempotencyKey: `stranger-${unique}` }).expect(404);
  });
});
