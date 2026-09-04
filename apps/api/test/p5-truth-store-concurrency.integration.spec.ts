import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TruthStoreService } from '../src/truth-store/truth-store.service';
import { bootP2App, register, type Session } from './p2-test-helpers';

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

describe.skipIf(!enabled).sequential('Truth Store MySQL atomic concurrency', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let truthStore: TruthStoreService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`truth-concurrency-${unique}`));
    user = await register(app, `truth-concurrency-${unique}@example.com`, 'Truth Concurrency');
    truthStore = app.get(TruthStoreService);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('creates exactly one complete truth record and one immutable version under concurrent confirmation', async () => {
    const connectionId = randomUUID();
    const receiptId = randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO device_app_connections (id, user_id, device_id, trusted_device_id, package_name, display_name, connection_type, integration_key, version_name, version_code, launchable, discovery_fingerprint, enabled, modes_json, trust_level, last_seen_at, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, NULL, ?, ?, 'generic', NULL, '1.0', 1, 1, ?, 1, JSON_ARRAY('notification_read'), 'key_proven', ?, ?, ?)`,
      [connectionId, user.userId, `device-${unique}`, 'com.example.realapp', '真实应用', 'a'.repeat(64), now, now, now],
    );
    await pool.query(
      `INSERT INTO mobile_notification_receipts (id, user_id, device_app_connection_id, event_id, payload_hash, source_package, posted_at, amount_minor, status, snapshot_json, received_at, verified_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, 'received_unclassified', JSON_OBJECT('schema', 'mobile-notification-minimal-v2', 'candidateKind', 'billing_transaction_candidate', 'candidateResource', 'mobile.billing.transaction', 'candidateConfidence', 80, 'currency', 'CNY', 'parserVersion', 'generic-notification-v1'), ?, NULL)`,
      [receiptId, user.userId, connectionId, 'b'.repeat(64), 'c'.repeat(64), 'com.example.realapp', now, 1234, now],
    );
    const receipt = {
      id: receiptId, userId: user.userId, deviceAppConnectionId: connectionId, eventId: 'b'.repeat(64), payloadHash: 'c'.repeat(64), sourcePackage: 'com.example.realapp', postedAt: now, amountMinor: 1234, status: 'received_unclassified',
      snapshotJson: { schema: 'mobile-notification-minimal-v2', candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 80, currency: 'CNY', parserVersion: 'generic-notification-v1' }, receivedAt: now, verifiedAt: null,
    } as never;

    const results = await Promise.all([truthStore.confirmMobileReceipt(user.userId, receipt), truthStore.confirmMobileReceipt(user.userId, receipt)]);
    expect(new Set(results.map((result) => result.id))).toHaveSize(1);
    const [records] = await pool.query<RowDataPacket[]>(
      `SELECT BIN_TO_UUID(r.id) id, BIN_TO_UUID(r.current_version_id) currentVersionId, COUNT(v.id) versionCount
         FROM truth_records r LEFT JOIN truth_record_versions v ON v.truth_record_id = r.id
        WHERE r.user_id = UUID_TO_BIN(?) AND r.source_receipt_id = UUID_TO_BIN(?)
        GROUP BY r.id, r.current_version_id`,
      [user.userId, receiptId],
    );
    expect(records).toEqual([expect.objectContaining({ currentVersionId: expect.any(String), versionCount: 1 })]);
  });
});
