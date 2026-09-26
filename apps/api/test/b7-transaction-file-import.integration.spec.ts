import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('B7 transaction file import through Reality Pipeline', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`b7-tx-file-${unique}`);
    app = booted.app;
    pool = booted.pool;
    owner = await register(app, `b7-tx-owner-${unique}@example.com`, 'B7 Tx Owner');
    stranger = await register(app, `b7-tx-stranger-${unique}@example.com`, 'B7 Tx Stranger');
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  const importTx = (payload: Record<string, unknown>, token = owner.token) =>
    request(app.getHttpServer()).post('/api/file-imports/transactions').set(auth(token)).send(payload);

  it('ingests transaction rows as candidates, never as trusted billing_records', async () => {
    const content = JSON.stringify({ records: [
      { accountKey: 'cash-account', transactionId: 'txn-001', amount: 128.6, currency: 'CNY', merchant: '测试商户', direction: 'DEBIT', transactionState: 'POSTED', occurredAt: '2026-09-01T08:00:00.000Z' },
      { accountKey: 'cash-account', transactionId: 'txn-002', amount: 88, currency: 'CNY', merchant: '另一商户', direction: 'CREDIT', transactionState: 'REFUND', relatedTransactionId: 'txn-001', occurredAt: '2026-09-02T08:00:00.000Z' },
    ] });
    const imported = await importTx({
      fileName: 'transactions.json', mimeType: 'application/json',
      contentBase64: Buffer.from(content).toString('base64'), idempotencyKey: `tx-${unique}`,
    }).expect(201);

    expect(imported.body).toMatchObject({ providerKey: 'local_file', status: 'completed', recordCount: 2, duplicate: false, candidateCount: 2 });
    expect(imported.body.failedRows).toEqual([]);

    // 交易不得直接进入 billing_records。
    const [billCount] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM billing_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect(Number(billCount[0].count)).toBe(0);

    // 候选以 PENDING 状态落地，等待用户确认，不自动成为可信事实。
    const [candidates] = await pool.query<RowDataPacket[]>('SELECT status, fact_key, subject_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.status).toBe('PENDING');
      expect(candidate.fact_key).toBe('finance.transaction.amount');
      expect(candidate.subject_key).toMatch(/^finance\.transaction:local_file:account:cash-account:txn-/);
    }
    // 未经确认的候选不得成为 Truth。
    const [truthCount] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM truth_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect(Number(truthCount[0].count)).toBe(0);
  });

  it('deduplicates the same source-namespaced transaction id', async () => {
    const content = JSON.stringify({ records: [
      { accountKey: 'cash-account', transactionId: 'txn-dup', amount: 50, currency: 'CNY', occurredAt: '2026-09-03T08:00:00.000Z' },
      { accountKey: 'cash-account', transactionId: 'txn-dup', amount: 50, currency: 'CNY', occurredAt: '2026-09-03T08:00:00.000Z' },
    ] });
    const imported = await importTx({
      fileName: 'dup.json', mimeType: 'application/json',
      contentBase64: Buffer.from(content).toString('base64'), idempotencyKey: `tx-dup-${unique}`,
    }).expect(201);
    expect(imported.body.status).toBe('completed');
    // 两行同名 transactionId → 归一化到同一 subjectKey，仅一条候选。
    const [dupRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND subject_key=?', [owner.userId, 'finance.transaction:local_file:account:cash-account:txn-dup']);
    expect(Number(dupRows[0].count)).toBe(1);
  });

  it('is idempotent per import key and isolates candidates per user', async () => {
    const content = JSON.stringify([{ transactionId: 'txn-iso', amount: 10, currency: 'CNY', occurredAt: '2026-09-04T08:00:00.000Z' }]);
    const payload = {
      fileName: 'iso.json', mimeType: 'application/json',
      contentBase64: Buffer.from(content).toString('base64'), idempotencyKey: `tx-iso-${unique}`,
    };
    const first = await importTx(payload).expect(201);
    const second = await importTx(payload).expect(201);
    expect(first.body.id).toBe(second.body.id);
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);

    const [ownerCount] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM candidate_facts WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    const [strangerCount] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM candidate_facts WHERE user_id=UUID_TO_BIN(?)', [stranger.userId]);
    expect(Number(ownerCount[0].count)).toBeGreaterThan(0);
    expect(Number(strangerCount[0].count)).toBe(0);
  });

  it('keeps partial parse failures explicit without dropping the whole batch', async () => {
    const content = JSON.stringify({ records: [
      { transactionId: 'txn-ok', amount: 20, currency: 'CNY', occurredAt: '2026-09-05T08:00:00.000Z' },
      { transactionId: 'txn-bad', amount: -5, currency: 'CNY', occurredAt: '2026-09-05T08:00:00.000Z' },
    ] });
    const imported = await importTx({
      fileName: 'partial.json', mimeType: 'application/json',
      contentBase64: Buffer.from(content).toString('base64'), idempotencyKey: `tx-partial-${unique}`,
    }).expect(201);
    expect(imported.body.status).toBe('completed_with_errors');
    expect(imported.body.candidateCount).toBe(1);
    expect(imported.body.failedRows).toEqual([2]);
  });

  it('rejects unsafe names and non-transaction files', async () => {
    await importTx({ fileName: '../tx.json', mimeType: 'application/json', contentBase64: Buffer.from('[]').toString('base64'), idempotencyKey: `tx-unsafe-${unique}` }).expect(400);
    await importTx({ fileName: 'bad.json', mimeType: 'application/json', contentBase64: Buffer.from('[{"amount":"oops"}]').toString('base64'), idempotencyKey: `tx-bad-${unique}` }).expect(400);
  });
});
