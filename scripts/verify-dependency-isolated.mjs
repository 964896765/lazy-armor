import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (process.argv.length !== 4 || process.argv[2] !== '--log') throw new Error('Use --log FRESH_PATH');
const logFile = path.resolve(root, process.argv[3]);
if (existsSync(logFile)) throw new Error('Fresh log required');
if (!existsSync(path.join(root, 'apps/api/dist/artifacts/extractor.worker.js'))) throw new Error('Build API before document acceptance');
const databaseName = 'lazy_armor_dependency_' + randomUUID().replaceAll('-', '').slice(0, 16) + '_test';
const prefix = 'dependency:' + randomUUID(), container = 'lazy-armor-v81-test-mysql-20261005';
const dbRequire = createRequire(path.join(root, 'packages/database/package.json'));
const mysql = dbRequire('mysql2/promise');
try {
  const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', windowsHide: true }))[0];
  if (!inspection.State.Running || !inspection.NetworkSettings.Ports['3306/tcp']?.some(binding => binding.HostPort === '3311')) throw new Error('Isolated MySQL3311 required');
  const env = Object.fromEntries(inspection.Config.Env.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  const sql = statement => execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'], { input: statement, encoding: 'utf8', windowsHide: true });
  if (sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=${mysql.escape(databaseName)}`).trim() !== '0') throw new Error('New empty database required');
  sql(`CREATE DATABASE \`${databaseName}\`; GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO ${mysql.escape(env.MYSQL_USER)}@'%';`);
  const url = new URL('mysql://127.0.0.1:3311/' + databaseName); url.username = env.MYSQL_USER; url.password = env.MYSQL_PASSWORD;
  const { createDatabase } = createRequire(import.meta.url)('../packages/database/dist');
  const { migrate } = dbRequire('drizzle-orm/mysql2/migrator');
  const { db, pool } = createDatabase(url.href);
  try { await migrate(db, { migrationsFolder: path.join(root, 'packages/database/drizzle') }); } finally { await pool.end(); }
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: 'wx' });
  console.log(JSON.stringify({ databaseName, isolated: true, phase: 'DEPENDENCY_API_REGRESSION_STARTED' }));
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'test/consumer-surfaces.integration.spec.ts', 'test/share-external-reference.integration.spec.ts', 'test/artifacts.integration.spec.ts', '--reporter=dot'], {
    cwd: path.join(root, 'apps/api'), windowsHide: true, env: { ...process.env, CI: 'true', NODE_ENV: 'test', APP_ENV: 'development', APP_ROLE: 'api',
      DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, TEST_DATABASE_NAME: databaseName, REQUIRE_EXACT_TEST_TARGET: '1',
      REDIS_URL: 'redis://127.0.0.1:6391/15', REDIS_KEY_PREFIX: prefix, TEST_REDIS_KEY_PREFIX: prefix,
      JWT_SECRET: 'test-jwt-secret-that-is-longer-than-thirty-two-characters', CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
      CREDENTIAL_STORE_PATH: path.join(root, 'artifacts', databaseName + '-credentials'),
      DEEPSEEK_SERVER_DEV_ENABLED: '0', AGENT_MODEL_API_KEY: '',
      MEMORY_REAL_MODEL_ACCEPTANCE: '0', PAGE_READ_REAL_MODEL_ACCEPTANCE: '0', PUBLIC_JSON_REAL_READ: '0', V90_REAL_ACCEPTANCE: '0',
      V91_REAL_REPORT_ACCEPTANCE: '0', V93_METHOD_PROCESS_ACCEPTANCE: '0' },
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('close', value => resolve(value ?? 1)); });
  await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
  console.log(JSON.stringify({ code, databaseName, logFile, scope: 'REAL_NEST_SQL_REDIS_NATIVE_IMAGE_DOCUMENT_FIXTURES' }));
  process.exitCode = code;
} catch (error) { console.error(typeof error?.code === 'string' ? error.code : 'DEPENDENCY_ISOLATED_ACCEPTANCE_FAILED'); process.exitCode = 1; }
