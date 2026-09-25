import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('B7 finance.accounting strategy loop', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let owner: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`b7-accounting-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    owner = await register(app, `b7-acct-${unique}@example.com`, 'B7 Accounting');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('installs the account-book-keeping template and reaches the template list', async () => {
    const templates = await request(app.getHttpServer()).get('/api/templates').set(auth(owner.token)).expect(200);
    expect(templates.body.map((item: { key: string }) => item.key)).toContain('account-book-keeping');
  });

  it('summarizes only confirmed transactions through the shared engine', async () => {
    // 确认一笔交易事实（仅 verified Truth 进入账目统计）。
    const ingested = await pipeline.ingest(owner.userId, {
      sourceMode: 'FILE', providerKey: 'local_file', externalEventKey: `event-${unique}`,
      parserKey: 'generic.transaction.v1', resourceHint: 'finance.transaction',
      payload: { transactionId: 'txn-001', amountMinor: 12850, currency: 'CNY', merchant: '测试商户', direction: 'DEBIT', transactionState: 'POSTED' },
      evidenceHash: hash(`event-${unique}`), observedAt: new Date().toISOString(),
    });
    await pipeline.confirmCandidate(owner.userId, ingested.candidates[0]!.id, {
      verifiedBy: 'deterministic_test', verificationMethod: 'source_evidence',
    });

    const installed = await request(app.getHttpServer())
      .post('/api/templates/account-book-keeping/install')
      .set(auth(owner.token))
      .send({ config: { planName: '家庭账目整理', summaryDay: 1, showCategories: true, notificationPreference: 'summary' } })
      .expect(201);
    const planId = installed.body.id as string;
    await activatePlan(app, owner.token, planId);

    const execution = await dispatchPlan(app, worker, owner.token, planId, {});
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toContain('账目已整理');
    expect(execution.body.resultSummary).toContain('1 笔');
    expect(execution.body.resultSummary).toContain('128.50');
  });

  it('does not include unconfirmed candidates in the account summary', async () => {
    // 导入一笔未确认候选（不 confirm），账目整理不得统计它。
    const pendingIngest = await pipeline.ingest(owner.userId, {
      sourceMode: 'FILE', providerKey: 'local_file', externalEventKey: `pending-${unique}`,
      parserKey: 'generic.transaction.v1', resourceHint: 'finance.transaction',
      payload: { transactionId: 'txn-pending', amountMinor: 99900, currency: 'CNY', merchant: '未确认商户', direction: 'DEBIT', transactionState: 'POSTED' },
      evidenceHash: hash(`pending-${unique}`), observedAt: new Date().toISOString(),
    });
    expect(pendingIngest.candidates).toHaveLength(1);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/account-book-keeping/install')
      .set(auth(owner.token))
      .send({ config: { planName: '只算已确认', summaryDay: 2, showCategories: true, notificationPreference: 'summary' } })
      .expect(201);
    const planId = installed.body.id as string;
    await activatePlan(app, owner.token, planId);

    const execution = await dispatchPlan(app, worker, owner.token, planId, {});
    expect(execution.body.status).toBe('succeeded');
    // 仍只有 1 笔已确认交易（txn-001），未确认候选（txn-pending）不计入。
    expect(execution.body.resultSummary).toContain('1 笔');
    expect(execution.body.resultSummary).toContain('128.50');
  });
});
