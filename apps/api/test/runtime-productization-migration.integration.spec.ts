import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createDatabase } from '@lazy-armor/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertMigrationTestDatabase } from './migration-database.guard';

describe('Batch 7/8 forward migration contracts', () => {
  let pool: Pool; let db: ReturnType<typeof createDatabase>['db'];
  const folder = resolve(process.cwd(), '../../packages/database/drizzle');
  beforeAll(() => {
    const url = assertMigrationTestDatabase(process.env.DATABASE_URL);
    ({ db, pool } = createDatabase(url));
  });
  afterAll(async () => { await pool?.end(); });
  it('extends existing webhook receipts with nullable leased acquisition, preserving legacy dedupe and no historical enqueue', async () => {
    const [columns] = await pool.query<RowDataPacket[]>("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='webhook_receipts' AND column_name LIKE 'acquisition_%'");
    expect(columns).toHaveLength(7); expect(columns.every((row) => (row.IS_NULLABLE ?? row.is_nullable) === 'YES')).toBe(true);
    const [indices] = await pool.query<RowDataPacket[]>("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='webhook_receipts' AND index_name IN ('webhook_receipts_connection_event_uq','webhook_receipts_connection_idempotency_uq','webhook_receipts_retention_idx','webhook_receipts_acquisition_claim_idx') GROUP BY index_name");
    expect(indices).toHaveLength(4);
    const source = readFileSync(resolve(folder, '0048_webhook_acquisition.sql'), 'utf8'); expect(source).not.toMatch(/\b(?:DROP|TRUNCATE|UPDATE|INSERT|DELETE)\b/i);
    const [before] = await pool.query<RowDataPacket[]>('SELECT id,event_id,idempotency_key,payload_hash,received_at,acquisition_status FROM webhook_receipts WHERE acquisition_provider_key IS NULL ORDER BY id LIMIT 10');
    expect(before.every((row) => row.acquisition_status === null)).toBe(true);
    await migrate(db, { migrationsFolder: folder });
    const [after] = await pool.query<RowDataPacket[]>('SELECT id,event_id,idempotency_key,payload_hash,received_at,acquisition_status FROM webhook_receipts WHERE acquisition_provider_key IS NULL ORDER BY id LIMIT 10'); expect(after).toEqual(before);
  });
  it('replays migrations without changing the ledger and verifies exact source checksums', async () => {
    const [before] = await pool.query<RowDataPacket[]>('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id');
    await migrate(db, { migrationsFolder: folder });
    const [after] = await pool.query<RowDataPacket[]>('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id');
    expect(after).toEqual(before);
    for (const file of ['0042_action_runtime_integration.sql', '0043_action_adapter_resolution.sql', '0044_verification_reconciliation.sql', '0045_provider_runtime_common.sql', '0046_google_oauth_completion.sql', '0047_generic_truth_identity.sql', '0048_webhook_acquisition.sql']) {
      const source = readFileSync(resolve(folder, file), 'utf8');
      expect(source).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
      const hash = createHash('sha256').update(source).digest('hex');
      expect(after.some((row) => row.hash === hash)).toBe(true);
    }
  });
  it('keeps optional historical bindings and restrictive foreign keys with unique evidence identities', async () => {
    const [columns] = await pool.query<RowDataPacket[]>("SELECT is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='execution_steps' AND column_name='action_intent_id'");
    expect(columns[0].IS_NULLABLE ?? columns[0].is_nullable).toBe('YES');
    const [keys] = await pool.query<RowDataPacket[]>("SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name IN ('action_intents','action_adapter_bindings','verification_evidence','reconciliation_cases')");
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.every((row) => (row.DELETE_RULE ?? row.delete_rule) === 'RESTRICT')).toBe(true);
    const [indices] = await pool.query<RowDataPacket[]>("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0 AND index_name IN ('verification_evidence_operation_key_uq','reconciliation_operation_uq','action_intents_execution_action_uq') GROUP BY index_name");
    expect(indices).toHaveLength(3);
  });
  it('extends historical provider evidence without backfill and pins immutable policy references', async () => {
    const [columns] = await pool.query<RowDataPacket[]>("SELECT is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='provider_capability_evidence' AND column_name IN ('provider_key','evidence_key','revision','evidence_hash','definition_json')");
    expect(columns).toHaveLength(5);
    expect(columns.every((row) => (row.IS_NULLABLE ?? row.is_nullable) === 'YES')).toBe(true);
    const [old] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM provider_capability_evidence WHERE provider_key IS NULL AND definition_json IS NULL");
    expect(old[0].n).toBeGreaterThanOrEqual(18);
    const [keys] = await pool.query<RowDataPacket[]>("SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='provider_runtime_policies'");
    expect(keys).toHaveLength(2);
    expect(keys.every((row) => (row.DELETE_RULE ?? row.delete_rule) === 'RESTRICT')).toBe(true);
    const [indices] = await pool.query<RowDataPacket[]>("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0 AND index_name IN ('provider_runtime_policy_revision_uq','provider_official_evidence_revision_uq') GROUP BY index_name");
    expect(indices).toHaveLength(2);
  });
  it('reuses one existing OAuth and verification store for Calendar without domain-specific engine or duplicate auth tables', async () => {
    const [tables] = await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('oauth_authorization_states','credential_refs','provider_runtime_policies','verification_policies','verification_evidence','reconciliation_cases')");
    expect(tables).toHaveLength(6);
    const [duplicates] = await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('calendar_oauth_states','calendar_credentials','calendar_execution_engine','gmail_execution_engine')");
    expect(duplicates).toHaveLength(0);
  });
  it('extends existing OAuth attempts with nullable completion metadata without rewriting historical states', async () => {
    const [columns] = await pool.query<RowDataPacket[]>("SELECT is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='oauth_authorization_states' AND column_name IN ('completion_status','failure_code')");
    expect(columns).toHaveLength(2);
    expect(columns.every((row) => (row.IS_NULLABLE ?? row.is_nullable) === 'YES')).toBe(true);
  });
  it('adds nullable stable fact identity without guessing historical identity or weakening existing unique constraints', async () => {
    const [columns] = await pool.query<RowDataPacket[]>("SELECT is_nullable,column_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='truth_records' AND column_name='fact_identity_hash'");
    expect(columns[0].IS_NULLABLE ?? columns[0].is_nullable).toBe('YES'); expect(columns[0].COLUMN_TYPE ?? columns[0].column_type).toBe('char(64)');
    const [indices] = await pool.query<RowDataPacket[]>("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0 AND index_name IN ('truth_records_fact_identity_uq','truth_records_user_receipt_uq','truth_record_versions_record_version_uq','truth_provenance_candidate_uq') GROUP BY index_name"); expect(indices).toHaveLength(4);
    const source = readFileSync(resolve(folder, '0047_generic_truth_identity.sql'), 'utf8'); expect(source).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
    const isolated = await pool.getConnection();
    try {
      await isolated.beginTransaction();
      await isolated.query("SET @migration_user=UUID_TO_BIN(UUID())");
      await isolated.query("INSERT INTO users(id,status,created_at,updated_at) VALUES(@migration_user,'active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))");
      for (let i = 0; i < 2; i++) await isolated.query("INSERT INTO truth_records(id,user_id,resource_key,subject_key,status,verified_by,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(UUID()),@migration_user,'historical','legacy','verified','migration_contract',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))");
      const [legacy] = await isolated.query<RowDataPacket[]>('SELECT fact_identity_hash FROM truth_records WHERE user_id=@migration_user'); expect(legacy).toHaveLength(2); expect(legacy.every((row) => row.fact_identity_hash === null)).toBe(true);
    } finally { await isolated.rollback(); isolated.release(); }
    const [before] = await pool.query<RowDataPacket[]>('SELECT id,current_version_id,verified_at FROM truth_records WHERE fact_identity_hash IS NULL ORDER BY id LIMIT 10');
    await migrate(db, { migrationsFolder: folder });
    const [after] = await pool.query<RowDataPacket[]>('SELECT id,current_version_id,verified_at FROM truth_records WHERE fact_identity_hash IS NULL ORDER BY id LIMIT 10'); expect(after).toEqual(before);
  });
});
