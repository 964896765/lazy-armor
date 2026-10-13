import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (![4,8].includes(process.argv.length) || process.argv[2] !== '--log') throw new Error('Use --log FRESH_PATH [--browser EXECUTABLE --screenshots FRESH_DIR]');
const browser=process.argv.length===8?process.argv[5]:undefined;
const screenshots=process.argv.length===8?path.resolve(root,process.argv[7]):undefined;
if (browser && (process.argv[4]!=='--browser'||process.argv[6]!=='--screenshots'||!existsSync(browser))) throw new Error('Valid browser and screenshots arguments required');
if (screenshots && existsSync(screenshots)) throw new Error('Fresh screenshot directory required');
const logFile = path.resolve(root, process.argv[3]);
if (existsSync(logFile)) throw new Error('Fresh log required');

const databaseName = 'lazy_armor_auth_m2_' + randomUUID().replaceAll('-', '').slice(0, 16) + '_test';
const prefix = 'auth_m2:' + randomUUID(), container = 'lazy-armor-v81-test-mysql-20261005';
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
  // Reviewable CLI backfill on ordinary users in this fresh isolated database.
  const seed=await mysql.createConnection({uri:url.href,timezone:'Z'});
  const fixtureIds=[randomUUID(),randomUUID()];
  try{
    const bcrypt=createRequire(path.join(root,'apps/api/package.json'))('bcryptjs');
    const fixtureHash=await bcrypt.hash('password-migration-fixture-only',12);
    for(const [index,userId] of fixtureIds.entries()){
      await seed.execute("INSERT INTO users(id,status,role,created_at,updated_at) VALUES(UUID_TO_BIN(?),'active','user',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[userId]);
      await seed.execute("INSERT INTO profiles(id,user_id,display_name,timezone,locale,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'Migration fixture','Asia/Shanghai','zh-CN',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),userId]);
      await seed.execute("INSERT INTO user_memberships(id,user_id,membership_plan_key,status,started_at,current_period_start,cancel_at_period_end,provider,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'free','active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),0,'internal',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),userId]);
      await seed.execute('INSERT INTO auth_identities(id,user_id,email,password_hash,email_verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))',[randomUUID(),userId,'migration-'+index+'-'+randomUUID()+'@example.test',fixtureHash,index?new Date():null]);
    }
    async function immutableState(){
      const material=[];
      for(const table of ['users','profiles','user_memberships','auth_identities','auth_sessions'])material.push((await seed.query('SELECT * FROM '+table+' ORDER BY id'))[0]);
      return createHash('sha256').update(JSON.stringify(material)).digest('hex');
    }
    const stateBefore=await immutableState(),privateEnv=path.join(root,'artifacts',databaseName+'.env');
    writeFileSync(privateEnv,'DATABASE_URL='+url.href+'\n',{flag:'wx'});
    const runCli=(mode,label)=>{
      const output=execFileSync(process.execPath,[path.join(root,'scripts/migrate-auth-password-credentials.mjs'),'--env',privateEnv,'--expected-database',databaseName,'--mode',mode,'--out',path.join(root,'artifacts',databaseName+'-'+label+'.json')],{encoding:'utf8',windowsHide:true});
      return JSON.parse(output.trim());
    };
    const pre=runCli('audit','pre'),first=runCli('apply','first'),second=runCli('apply','second');
    if(pre.missingUsers!==2||first.copied!==2||second.copied!==0||second.unchanged!==2||!second.readyForUnified||stateBefore!==await immutableState())throw new Error('CLI_BACKFILL_INVARIANTS_FAILED');
    console.log(JSON.stringify({phase:'CLI_BACKFILL_IDEMPOTENCE_PASSED',isolated:true,copied:2,replayCopies:0,originalAccountStateUnchanged:true}));
  }finally{await seed.end();}

  if(screenshots)mkdirSync(screenshots,{recursive:true});
  const log = createWriteStream(logFile, { flags: 'wx' });
  console.log(JSON.stringify({ databaseName, isolated: true, phase: 'AUTH_M2_API_REGRESSION_STARTED' }));
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'test/auth-password-credentials.integration.spec.ts', 'test/auth-v2.integration.spec.ts', 'test/p0-final-security.spec.ts', 'test/login-code.spec.ts', 'test/password-reset-delivery.spec.ts', 'test/password-credential-startup.spec.ts', '--reporter=dot', '--hookTimeout=90000'], {
    cwd: path.join(root, 'apps/api'), windowsHide: true, env: { ...process.env, CI: 'true', NODE_ENV: 'test', APP_ENV: 'development', APP_ROLE: 'api',
      DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, TEST_DATABASE_NAME: databaseName, REQUIRE_EXACT_TEST_TARGET: '1',
      REDIS_URL: 'redis://127.0.0.1:6391/15', REDIS_KEY_PREFIX: prefix, TEST_REDIS_KEY_PREFIX: prefix,
      JWT_SECRET: 'test-jwt-secret-that-is-longer-than-thirty-two-characters', CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
      CREDENTIAL_STORE_PATH: path.join(root, 'artifacts', databaseName + '-credentials'),
      DEEPSEEK_SERVER_DEV_ENABLED: '0', AGENT_MODEL_API_KEY: '', AUTH_PASSWORD_CREDENTIAL_MODE:'LEGACY',
      MEMORY_REAL_MODEL_ACCEPTANCE: '0', PAGE_READ_REAL_MODEL_ACCEPTANCE: '0', PUBLIC_JSON_REAL_READ: '0', V90_REAL_ACCEPTANCE: '0',
      V91_REAL_REPORT_ACCEPTANCE: '0', V93_METHOD_PROCESS_ACCEPTANCE: '0', AUTH_V2_BROWSER_EXECUTABLE:browser??'', AUTH_V2_SCREENSHOT_DIR:screenshots??'' },
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('close', value => resolve(value ?? 1)); });
  await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
  if(code===0){
    // Full fixture dump/restore with nonempty auth credentials, versions and sessions.
    const restoredName=databaseName.replace(/_test$/,'_restored_test');
    if(!/^lazy_armor_auth_m2_[a-f0-9]+_restored_test$/.test(restoredName))throw new Error('Exact isolated restore target required');
    if(sql('SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='+mysql.escape(restoredName)).trim()!=='0')throw new Error('Fresh restore database required');
    const dump=execFileSync('docker',['exec','-i',container,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --hex-blob --skip-comments "$1"','auth-fixture-dump',databaseName],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
    const backupFile=path.join(root,'artifacts',databaseName+'-auth-backup.sql');
    writeFileSync(backupFile,dump,{flag:'wx'});
    sql('CREATE DATABASE '+mysql.escapeId(restoredName)+'; GRANT ALL PRIVILEGES ON '+mysql.escapeId(restoredName)+'.* TO '+mysql.escape(env.MYSQL_USER)+"@'%';");
    execFileSync('docker',['exec','-i',container,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$1"','auth-fixture-restore',restoredName],{input:dump,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
    const source=await mysql.createConnection({uri:url.href,timezone:'Z'}),restoreUrl=new URL(url.href);restoreUrl.pathname='/'+restoredName;
    const restored=await mysql.createConnection({uri:restoreUrl.href,timezone:'Z'});
    try{
      const tables=['users','profiles','user_memberships','login_identifiers','auth_identities','password_credentials','auth_sessions','password_reset_tokens','audit_logs'];
      let passwordUsers=0;
      for(const table of tables){
        const before=(await source.query('SELECT * FROM '+table+' ORDER BY id'))[0],after=(await restored.query('SELECT * FROM '+table+' ORDER BY id'))[0];
        const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
        if(digest(before)!==digest(after))throw new Error('AUTH_RESTORE_STATE_MISMATCH');
        if(table==='password_credentials')passwordUsers=before.length;
      }
      if(passwordUsers<2)throw new Error('Nonempty password credential recovery required');
      console.log(JSON.stringify({phase:'NONEMPTY_AUTH_BACKUP_RESTORE_PASSED',isolated:true,passwordUsers,tablesChecked:tables.length,backupPrivate:true}));
    }finally{await source.end();await restored.end();}
  }
  console.log(JSON.stringify({ code, databaseName, logFile, scope: 'REAL_NEST_SQL_REDIS_AUTH_FIXTURES' }));
  process.exitCode = code;
} catch (error) { console.error(typeof error?.code === 'string' ? error.code : 'AUTH_M2_ISOLATED_ACCEPTANCE_FAILED'); process.exitCode = 1; }
