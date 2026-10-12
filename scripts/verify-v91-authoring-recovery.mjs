import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd(), options = {};
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (!['--log', '--evidence'].includes(flag) || !process.argv[index + 1] || options[flag]) throw new Error('Use --log FRESH_PATH --evidence FRESH_PATH');
  options[flag] = process.argv[++index];
}
if (!options['--log'] || !options['--evidence']) throw new Error('Explicit fresh log and evidence required');
const logFile = path.resolve(root, options['--log']), evidence = path.resolve(root, options['--evidence']);
if (logFile.toLowerCase() === evidence.toLowerCase() || [logFile, evidence].some(existsSync)) throw new Error('Fresh distinct artifacts required');
if (!existsSync(path.join(root, 'apps/api/dist/orchestrator/authoring-jobs.service.js'))) throw new Error('Build API before process acceptance');
const databaseName = 'lazy_armor_v91_process_' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '_' + randomUUID().slice(0, 8) + '_test';
if (!/^lazy_armor_v91_process_\d{8}_[a-f0-9]{8}_test$/.test(databaseName)) throw new Error('Invalid isolated database name');
const dbRequire = createRequire(path.join(root, 'packages/database/package.json'));
const mysql = dbRequire('mysql2/promise'), { migrate } = dbRequire('drizzle-orm/mysql2/migrator');
const { createDatabase } = createRequire(import.meta.url)('../packages/database/dist');
const container = 'lazy-armor-v81-test-mysql-20261005';
try {
  const containerEnv = Object.fromEntries(JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', container],
    { encoding: 'utf8', windowsHide: true })).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  const url = new URL('mysql://127.0.0.1:3311/' + databaseName); url.username = containerEnv.MYSQL_USER; url.password = containerEnv.MYSQL_PASSWORD;
  const sql = statement => execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'],
    { input: statement, encoding: 'utf8', windowsHide: true });
  if (sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=${mysql.escape(databaseName)}`).trim() !== '0') throw new Error('New empty database required');
  sql(`CREATE DATABASE \`${databaseName}\`; GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO ${mysql.escape(containerEnv.MYSQL_USER)}@'%';`);
  const { db, pool } = createDatabase(url.href);
  try { await migrate(db, { migrationsFolder: path.join(root, 'packages/database/drizzle') }); }
  finally { await pool.end(); }
  mkdirSync(path.dirname(logFile), { recursive: true }); mkdirSync(path.dirname(evidence), { recursive: true });
  const prefix = 'v91-process:' + randomUUID(), log = createWriteStream(logFile, { flags: 'wx' });
  console.log(JSON.stringify({ databaseName, isolated: true, phase: 'PROCESS_TEST_STARTED' }));
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/v91-authoring-process.integration.spec.ts', '--pool=threads', '--reporter=dot'], {
    cwd: path.join(root, 'apps/api'), windowsHide: true, env: { ...process.env, CI: 'true', NODE_ENV: 'test', APP_ENV: 'development', APP_ROLE: 'api',
      DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, TEST_DATABASE_NAME: databaseName, REQUIRE_EXACT_TEST_TARGET: '1',
      REDIS_URL: 'redis://127.0.0.1:6391/15', REDIS_KEY_PREFIX: prefix, TEST_REDIS_KEY_PREFIX: prefix,
      JWT_SECRET: 'test-jwt-secret-that-is-longer-than-thirty-two-characters', CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
      CREDENTIAL_STORE_PATH: path.join(root, 'artifacts', databaseName + '-credentials'), TEMP: path.join(root, '.data'), TMP: path.join(root, '.data'),
      MEMORY_REAL_MODEL_ACCEPTANCE: '0', PAGE_READ_REAL_MODEL_ACCEPTANCE: '0', PUBLIC_JSON_REAL_READ: '0', V90_REAL_ACCEPTANCE: '0',
      V91_REAL_REPORT_ACCEPTANCE: '0', V91_PROCESS_REPORTS: '1', V91_PROCESS_EVIDENCE: evidence },
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('close', value => resolve(value ?? 1)); });
  await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
  console.log(JSON.stringify({ code, databaseName, logFile, evidence, scope: 'FIXTURE_MODEL_REAL_CHILD_PROCESSES_SQL_REDIS', mobileAcceptance: 'PENDING' }));
  process.exitCode = code;
} catch (error) { console.error(typeof error?.code === 'string' ? error.code : 'V91_ISOLATED_PROCESS_RECOVERY_FAILED'); process.exitCode = 1; }
