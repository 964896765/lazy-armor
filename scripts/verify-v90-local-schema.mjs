import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BETA_METHOD_TABLES, localBetaDatabaseTarget, summarizeBetaSchema } from './lib/beta-local-schema.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('Use --output FRESH_JSON_PATH');
const output = args[1] ? path.resolve(args[1]) : null;
if (output && existsSync(output)) throw new Error('Fresh evidence path required');
try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const target = localBetaDatabaseTarget(process.env), require = createRequire(import.meta.url);
  const { createDatabase } = require('../packages/database/dist');
  const journal = JSON.parse(readFileSync('packages/database/drizzle/meta/_journal.json', 'utf8')).entries;
  const digest = text => createHash('sha256').update(text).digest('hex');
  const expected = journal.map(entry => {
    const sql = readFileSync(`packages/database/drizzle/${entry.tag}.sql`, 'utf8'), lf = sql.replace(/\r\n/g, '\n');
    return { tag: entry.tag, when: entry.when, hash: digest(sql), lineEndingHashes: [digest(lf), digest(lf.replace(/\n/g, '\r\n'))] };
  });
  const observedAt = new Date().toISOString(), { pool } = createDatabase(process.env.DATABASE_URL);
  let schema;
  try {
    const [ledger] = await pool.query('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at');
    const [tables] = await pool.query('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?,?,?)', BETA_METHOD_TABLES);
    schema = summarizeBetaSchema(expected, ledger, tables.map(table => table.name));
  } finally { await pool.end(); }
  const report = { schemaVersion: 'v90-local-schema.v1', observedAt, completedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(), target, ...schema,
    scope: 'Read-only local development migration/table prerequisites; only LF/CRLF variants distinguished; existing ledger preserved; not migration release evidence', betaAcceptance: 'REAL_PENDING' };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2)); process.exitCode = schema.schemaReady ? 0 : 2;
} catch (error) {
  console.error(error.message === 'LOCAL_DEVELOPMENT_TARGET_REQUIRED' ? error.message : 'LOCAL_SCHEMA_CHECK_FAILED');
  process.exitCode = 1;
}
