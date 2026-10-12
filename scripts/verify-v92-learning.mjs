import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const prepareOnly = args.includes('--prepare-only');
const skipMigrate = args.includes('--skip-migrate');
const logIndex = args.indexOf('--log');
const logFile = logIndex >= 0 ? path.resolve(root, args[logIndex + 1] ?? '') : null;
const tests = args.filter(value => /^test\/[a-zA-Z0-9_.-]+\.spec\.ts$/.test(value));
if (!prepareOnly && (!logFile || existsSync(logFile) || !tests.length)) throw new Error('Fresh log and explicit test files required');
const dbRequire = createRequire(path.join(root, 'packages/database/package.json'));
const mysql = dbRequire('mysql2/promise');
const { migrate } = dbRequire('drizzle-orm/mysql2/migrator');
const { createDatabase } = createRequire(import.meta.url)('../packages/database/dist');
const databaseName = 'lazy_armor_v92_20261012_test';
const container = 'lazy-armor-v81-test-mysql-20261005';
if (!databaseName.endsWith('_test')) throw new Error('Isolated test database required');
try {
  const containerEnv = Object.fromEntries(JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', container],
    { encoding: 'utf8', windowsHide: true })).map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; }));
  const url = new URL('mysql://127.0.0.1:3311/' + databaseName);
  url.username = containerEnv.MYSQL_USER; url.password = containerEnv.MYSQL_PASSWORD;
  const sql = statement => execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'],
    { input: statement, encoding: 'utf8', windowsHide: true });
  if (!skipMigrate) {
    if (sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=${mysql.escape(databaseName)}`).trim() === '0') {
      sql(`CREATE DATABASE \`${databaseName}\`; GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO ${mysql.escape(containerEnv.MYSQL_USER)}@'%';`);
    }
    const { db, pool } = createDatabase(url.href);
    try { await migrate(db, { migrationsFolder: path.join(root, 'packages/database/drizzle') }); }
    finally { await pool.end(); }
  }
  if (prepareOnly) { console.log(JSON.stringify({ databaseName, schemaPrepared: true, production: false })); }
  else {
    const prefix = 'v92:' + randomUUID();
    const log = createWriteStream(logFile, { flags: 'wx' });
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--pool=threads', '--reporter=dot'],
      { cwd: path.join(root, 'apps/api'), windowsHide: true, env: { ...process.env, CI: 'true', NODE_ENV: 'test', APP_ROLE: 'api', APP_ENV: 'development',
        DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, TEST_DATABASE_NAME: databaseName, REQUIRE_EXACT_TEST_TARGET: '1',
        REDIS_URL: 'redis://127.0.0.1:6391/15', REDIS_KEY_PREFIX: prefix, TEST_REDIS_KEY_PREFIX: prefix,
        JWT_SECRET: 'test-jwt-secret-that-is-longer-than-thirty-two-characters', CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
        CREDENTIAL_STORE_PATH: path.join(root, 'artifacts/v92-test-credentials'), TEMP: path.join(root, '.data'), TMP: path.join(root, '.data'),
        MEMORY_REAL_MODEL_ACCEPTANCE: '0', PAGE_READ_REAL_MODEL_ACCEPTANCE: '0', PUBLIC_JSON_REAL_READ: '0', V90_REAL_ACCEPTANCE: '0' } });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('close', value => resolve(value ?? 1)); });
    await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
    console.log(JSON.stringify({ code, databaseName, logFile, tests, scope: 'ISOLATED_AUTOMATION_ONLY' }));
    process.exitCode = code;
  }
} catch (error) { console.error(error.code ?? 'V92_ISOLATED_CHECK_FAILED'); process.exitCode = 1; }
