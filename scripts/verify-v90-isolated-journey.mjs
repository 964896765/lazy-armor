import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd(), options = {};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--real' && !options.real) { options.real = true; continue; }
  if (!['--log', '--evidence'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Use --log FRESH_PATH [--real --evidence FRESH_PATH]');
  options[args[index]] = args[++index];
}
if (!options['--log'] || (options.real && !options['--evidence'])) throw new Error('Fresh log and explicit real-mode evidence path required');
const logFile = path.resolve(root, options['--log']), evidence = options['--evidence'] ? path.resolve(root, options['--evidence']) : null;
if (existsSync(logFile) || (evidence && existsSync(evidence)) || evidence === logFile) throw new Error('Fresh distinct evidence paths required');
if (options.real && existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const require = createRequire(import.meta.url), dbRequire = createRequire(path.join(root, 'packages/database/package.json'));
const mysql = dbRequire('mysql2/promise'), { migrate } = dbRequire('drizzle-orm/mysql2/migrator');
const { createDatabase } = require('../packages/database/dist');
const databaseName = 'lazy_armor_v88_v89_20261010_test', container = 'lazy-armor-v81-test-mysql-20261005';
if (!databaseName.endsWith('_test') || databaseName === 'lazy_armor') throw new Error('Isolated database required');
try {
  const containerEnv = Object.fromEntries(JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', container],
    { encoding: 'utf8', windowsHide: true })).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  const database = new URL('mysql://127.0.0.1:3311/' + databaseName); database.username = containerEnv.MYSQL_USER; database.password = containerEnv.MYSQL_PASSWORD;
  const sql = statement => execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'],
    { input: statement, encoding: 'utf8', windowsHide: true });
  if (sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=${mysql.escape(databaseName)}`).trim() === '0') {
    sql(`CREATE DATABASE \`${databaseName}\`; GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO ${mysql.escape(containerEnv.MYSQL_USER)}@'%';`);
  }
  const { db, pool } = createDatabase(database.href);
  try { await migrate(db, { migrationsFolder: path.join(root, 'packages/database/drizzle') }); } finally { await pool.end(); }
  const prefix = 'v90-isolated:' + randomUUID(), log = createWriteStream(logFile, { flags: 'wx' });
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/v90-beta-journey.integration.spec.ts', '--reporter=dot'],
    { cwd: path.join(root, 'apps/api'), windowsHide: true, env: { ...process.env, CI: 'true', NODE_ENV: 'test', DATABASE_URL: database.href,
      TEST_DATABASE_URL: database.href, TEST_DATABASE_NAME: databaseName, REQUIRE_EXACT_TEST_TARGET: '1', REDIS_URL: 'redis://127.0.0.1:6379/15',
      REDIS_KEY_PREFIX: prefix, TEST_REDIS_KEY_PREFIX: prefix, CREDENTIAL_STORE_PATH: path.join(root, 'artifacts/v90-isolated-test-credentials'),
      MEMORY_REAL_MODEL_ACCEPTANCE: '0', PAGE_READ_REAL_MODEL_ACCEPTANCE: '0', PUBLIC_JSON_REAL_READ: '0',
      V90_REAL_ACCEPTANCE: options.real ? '1' : '0', V90_REAL_EVIDENCE: evidence ?? '' } });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise(resolve => {
    child.once('error', () => resolve(1)); child.once('close', value => resolve(value ?? 1));
  });
  await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
  console.log(JSON.stringify({ code, mode: options.real ? 'REAL_MODEL_AND_PUBLIC_RESPONSE_ISOLATED' : 'FIXTURE_AUTOMATION', databaseName,
    logFile, evidence, betaAcceptance: 'REAL_PENDING', scope: 'Never switches current services, consumes user data or claims phone/third-party/Goal Runtime/seven-day closure' }));
  process.exitCode = code;
} catch (error) { console.error(error.code ?? 'ISOLATED_BETA_JOURNEY_FAILED'); process.exitCode = 1; }
