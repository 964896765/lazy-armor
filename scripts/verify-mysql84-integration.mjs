import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = process.cwd();
const databaseRequire = createRequire(path.join(repoRoot, 'packages', 'database', 'package.json'));
const mysql = databaseRequire('mysql2/promise');
const databaseUrl = process.env.DATABASE_URL ?? 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
const evidencePath = process.env.MYSQL84_EVIDENCE_PATH ?? path.join(repoRoot, 'artifacts', 'rc-evidence', 'mysql84-migration-evidence.json');
const target = new URL(databaseUrl);
const pool = mysql.createPool({
  host: target.hostname,
  port: Number(target.port || '3306'),
  user: decodeURIComponent(target.username),
  password: decodeURIComponent(target.password),
  database: target.pathname.slice(1),
  connectionLimit: 2,
  timezone: 'Z',
});

try {
  const [versionRows] = await pool.query('SELECT VERSION() AS version');
  const version = versionRows[0]?.version;
  if (typeof version !== 'string' || !/^8\.4\./.test(version)) throw new Error(`MySQL 8.4 is required for RC integration evidence; connected server reports ${String(version)}`);
  const requiredTables = ['trusted_devices', 'trusted_device_challenges', 'trusted_device_request_sessions', 'trusted_device_request_proofs', 'device_app_connections', 'mobile_notification_receipts', 'truth_records', 'truth_record_versions'];
  const [tableRows] = await pool.query(
    `SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${requiredTables.map(() => '?').join(', ')})`,
    requiredTables,
  );
  const found = new Set(tableRows.map((row) => row.tableName));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length > 0) throw new Error(`MySQL 8.4 migration evidence is incomplete; missing tables: ${missing.join(', ')}`);
  const [migrationRows] = await pool.query('SELECT COUNT(*) AS count FROM __drizzle_migrations');
  const evidence = { schema: 'lazy-armor.mysql84-migration-evidence.v1', generatedAt: new Date().toISOString(), ok: true, mysqlVersion: version, database: target.pathname.slice(1), requiredTables, drizzleMigrationCount: Number(migrationRows[0]?.count ?? 0) };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
} finally {
  await pool.end();
}
