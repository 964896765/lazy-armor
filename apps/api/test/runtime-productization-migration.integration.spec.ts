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
  it('replays migrations without changing the ledger and verifies exact source checksums', async () => {
    const [before] = await pool.query<RowDataPacket[]>('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id');
    await migrate(db, { migrationsFolder: folder });
    const [after] = await pool.query<RowDataPacket[]>('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id');
    expect(after).toEqual(before);
    for (const file of ['0042_action_runtime_integration.sql', '0043_action_adapter_resolution.sql', '0044_verification_reconciliation.sql', '0045_provider_runtime_common.sql']) {
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
});
