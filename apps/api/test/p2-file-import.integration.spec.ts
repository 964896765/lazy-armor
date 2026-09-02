import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P2-3 local file import adapter', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let otherUser: Session;
  let fileConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`file-import-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p2-file-${unique}@example.com`, 'P2 File Import');
    otherUser = await register(app, `p2-file-other-${unique}@example.com`, 'P2 File Other');
    const connection = await request(app.getHttpServer()).post('/api/connections').set(auth(user.token)).send({
      connectorId: 'file_provider', externalAccountName: '本地文件选择器',
    }).expect(201);
    fileConnectionId = connection.body.id as string;
    await request(app.getHttpServer()).put(`/api/connections/${fileConnectionId}/permissions`).set(auth(user.token)).send({
      permissions: ['READ_FILE_METADATA', 'READ_FILE'].map((capability) => ({ capability, granted: true })),
    }).expect(200);
  });

  it('implements READ_FILE_METADATA and READ_FILE without a cloud-drive mirror', async () => {
    const contentBase64 = Buffer.from('provider,category,billingPeriod,amount,currency,occurredAt').toString('base64');
    const input = { fileName: 'headers.csv', mimeType: 'text/csv', contentBase64 };
    const metadata = await request(app.getHttpServer()).post(`/api/connections/${fileConnectionId}/invoke`).set(auth(user.token)).send({
      capability: 'READ_FILE_METADATA', requestId: `file-meta-${unique}`, input,
    }).expect(201);
    expect(metadata.body).toMatchObject({ fileName: 'headers.csv', mimeType: 'text/csv', sizeBytes: expect.any(Number), contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(metadata.body).not.toHaveProperty('contentBase64');
    const read = await request(app.getHttpServer()).post(`/api/connections/${fileConnectionId}/invoke`).set(auth(user.token)).send({
      capability: 'READ_FILE', requestId: `file-read-${unique}`, input,
    }).expect(201);
    expect(read.body).toMatchObject({ contentBase64, contentSha256: metadata.body.contentSha256 });
    const matrix = await request(app.getHttpServer()).get('/api/connectors/file_provider').expect(200);
    expect(matrix.body).toMatchObject({ productionStatus: 'BETA', authentication: { type: 'none' }, connectable: false });
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('reads a selected JSON file, stores minimal provenance, and idempotently creates billing records', async () => {
    const privateValue = `private-note-${unique}`;
    const content = JSON.stringify({ records: [
      { provider: '电力公司', category: '水电', billingPeriod: '2026-08', amount: 128.6, currency: 'CNY', occurredAt: '2026-08-20T08:00:00.000Z', privateMemo: privateValue },
      { provider: '通信公司', category: '话费', billingPeriod: '2026-08', amount: 88, currency: 'CNY', occurredAt: '2026-08-21T08:00:00.000Z' },
    ] });
    const payload = {
      fileName: 'august-bills.json', mimeType: 'application/json',
      contentBase64: Buffer.from(content).toString('base64'), idempotencyKey: `file-${unique}`,
    };
    const imported = await request(app.getHttpServer())
      .post('/api/file-imports/billing').set(auth(user.token)).send(payload).expect(201);
    expect(imported.body).toMatchObject({ providerKey: 'local_file', fileName: 'august-bills.json', status: 'completed', recordCount: 2, duplicate: false });
    expect(JSON.stringify(imported.body)).not.toContain(privateValue);
    expect(imported.body).not.toHaveProperty('contentBase64');

    const duplicate = await request(app.getHttpServer())
      .post('/api/file-imports/billing').set(auth(user.token)).send(payload).expect(201);
    expect(duplicate.body).toMatchObject({ id: imported.body.id, recordCount: 2, duplicate: true });

    const records = await request(app.getHttpServer())
      .get('/api/billing-records?billingPeriod=2026-08').set(auth(user.token)).expect(200);
    const importedRecords = records.body.filter((record: { sourceType: string }) => record.sourceType === 'file');
    expect(importedRecords).toHaveLength(2);

    const [countRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM billing_records WHERE user_id=UUID_TO_BIN(?) AND source_type=\'file\'', [user.userId]);
    expect(Number(countRows[0].count)).toBe(2);
    const [auditRows] = await pool.query<RowDataPacket[]>('SELECT after_snapshot_json FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action=\'BILLING_FILE_IMPORTED\'', [user.userId]);
    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows[0])).not.toContain(privateValue);
  });

  it('rejects unsafe names and malformed records before persistence', async () => {
    await request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(user.token)).send({
      fileName: '../bills.json', mimeType: 'application/json', contentBase64: Buffer.from('[]').toString('base64'), idempotencyKey: `unsafe-${unique}`,
    }).expect(400);
    await request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(user.token)).send({
      fileName: 'bad.json', mimeType: 'application/json', contentBase64: Buffer.from('[{"amount":"oops"}]').toString('base64'), idempotencyKey: `bad-${unique}`,
    }).expect(400);
    await request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(user.token)).send({
      fileName: 'too-large.csv', mimeType: 'text/csv', contentBase64: Buffer.alloc(1_000_001, 65).toString('base64'), idempotencyKey: `large-${unique}`,
    }).expect(400);
  });

  it('serializes concurrent duplicate imports and keeps provenance user-owned', async () => {
    const payload = {
      fileName: 'concurrent.json', mimeType: 'application/json', idempotencyKey: `concurrent-${unique}`,
      contentBase64: Buffer.from(JSON.stringify([{ provider: '宽带公司', category: '宽带', billingPeriod: '2026-09', amount: 99, currency: 'CNY', occurredAt: '2026-09-01T00:00:00.000Z' }])).toString('base64'),
    };
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(user.token)).send(payload),
      request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(user.token)).send(payload),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.id).toBe(second.body.id);
    expect([first.body.duplicate, second.body.duplicate].sort()).toEqual([false, true]);
    const own = await request(app.getHttpServer()).get('/api/file-imports').set(auth(user.token)).expect(200);
    const other = await request(app.getHttpServer()).get('/api/file-imports').set(auth(otherUser.token)).expect(200);
    expect(own.body.some((item: { id: string }) => item.id === first.body.id)).toBe(true);
    expect(other.body.some((item: { id: string }) => item.id === first.body.id)).toBe(false);
  });
});
