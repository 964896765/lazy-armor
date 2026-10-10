export const BETA_METHOD_TABLES = ['skill_repositories', 'skill_entries', 'skill_entry_revisions', 'plan_skill_references'];

// This tooling has no staging/production target and never performs migrations.
export function localBetaDatabaseTarget(env) {
  if (env.APP_ENV !== 'development' || env.NODE_ENV === 'production') throw new Error('LOCAL_DEVELOPMENT_TARGET_REQUIRED');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('LOCAL_DEVELOPMENT_TARGET_REQUIRED'); }
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || url.port !== '3307' || url.pathname !== '/lazy_armor' || url.search || url.hash) {
    throw new Error('LOCAL_DEVELOPMENT_TARGET_REQUIRED');
  }
  return { host: url.hostname, port: Number(url.port), database: url.pathname.slice(1) };
}

export function summarizeBetaSchema(expected, ledger, tableNames) {
  const pendingMigrations = [], historicalHashDrift = [], lineEndingDifferences = [], seen = new Set();
  for (const migration of expected) {
    const rows = ledger.filter(row => Number(row.created_at) === migration.when);
    if (!rows.length) pendingMigrations.push(migration.tag);
    else if (rows.length !== 1) historicalHashDrift.push(migration.tag);
    else if (rows[0].hash !== migration.hash) {
      if (migration.lineEndingHashes?.includes(rows[0].hash)) lineEndingDifferences.push(migration.tag);
      else historicalHashDrift.push(migration.tag);
    }
    if (rows.length) seen.add(migration.when);
  }
  const unexpectedLedgerEntries = ledger.filter(row => !seen.has(Number(row.created_at))).length;
  const tables = BETA_METHOD_TABLES.map(name => ({ name, present: tableNames.includes(name) }));
  const methodsMigration = expected.find(row => row.tag === '0090_skill_repositories');
  const methodsSchemaReady = Boolean(methodsMigration) && !pendingMigrations.includes(methodsMigration.tag)
    && !historicalHashDrift.includes(methodsMigration.tag) && tables.every(table => table.present);
  return { pendingMigrations, historicalHashDrift, lineEndingDifferences, unexpectedLedgerEntries, tables, methodsSchemaReady,
    exactLedgerMatches: pendingMigrations.length === 0 && historicalHashDrift.length === 0 && lineEndingDifferences.length === 0 && unexpectedLedgerEntries === 0,
    schemaReady: methodsSchemaReady && pendingMigrations.length === 0 && historicalHashDrift.length === 0 && unexpectedLedgerEntries === 0 };
}
