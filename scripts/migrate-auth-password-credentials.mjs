import { createRequire } from 'node:module';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { auditPasswordCredentialMigration } from './lib/auth-password-migration.mjs';
const root=process.cwd(),options={};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--env','--expected-database','--mode','--out'].includes(key)||!process.argv[i+1]||options[key])throw new Error('Use --env ENV_FILE --expected-database NAME --mode audit|apply --out FRESH_PRIVATE_REPORT');options[key]=process.argv[i+1];}
if(Object.keys(options).length!==4||!['audit','apply'].includes(options['--mode']))throw new Error('Explicit audit/apply options required');
const out=path.resolve(root,options['--out']),privateRoot=path.join(root,'artifacts')+path.sep;
if(existsSync(out)||!out.startsWith(privateRoot))throw new Error('Fresh private artifacts report required');
const require=createRequire(path.join(root,'apps/api/package.json'));
const env=require('dotenv').parse(readFileSync(path.resolve(root,options['--env'])));
if(!env.DATABASE_URL)throw new Error('Explicit database configuration required');
const target=new URL(env.DATABASE_URL),databaseName=target.pathname.slice(1);
if(target.protocol!=='mysql:'||databaseName!==options['--expected-database'])throw new Error('Exact expected MySQL database required');
// Write tooling in this batch is deliberately restricted to the known local test endpoint.
if(options['--mode']==='apply'&&(target.hostname!=='127.0.0.1'||target.port!=='3311'||!/^lazy_armor_[a-z0-9_]+_test$/.test(databaseName)))throw new Error('Apply is restricted to exact isolated MySQL3311 test databases');
let connection,pool;
try{
 connection=await require('mysql2/promise').createConnection({uri:env.DATABASE_URL,timezone:'Z'});
 const before=await auditPasswordCredentialMigration(connection);
 let copied=0,unchanged=0;
 if(options['--mode']==='apply'){
  if(!before.canBackfill)throw new Error('PASSWORD_BACKFILL_BLOCKED_BY_AUDIT');
  require('reflect-metadata');
  const {createDatabase}=require(path.join(root,'packages/database/dist'));
  const created=createDatabase(env.DATABASE_URL);pool=created.pool;
  const {PasswordCredentialService}=require(path.join(root,'apps/api/dist/auth/password-credential.service'));
  const {AuditService}=require(path.join(root,'apps/api/dist/audit/audit.service'));
  const {SnapshotSanitizer}=require(path.join(root,'apps/api/dist/common/snapshot-sanitizer.service'));
  const service=new PasswordCredentialService(created.db,{get:key=>key==='AUTH_PASSWORD_CREDENTIAL_MODE'?'SHADOW':undefined},new AuditService(created.db,new SnapshotSanitizer()));
  const [owners]=await connection.query('SELECT DISTINCT BIN_TO_UUID(user_id) AS userId FROM auth_identities ORDER BY userId');
  for(const owner of owners){const result=await service.backfillUser(owner.userId);if(result.migrated)copied++;else unchanged++;}
 }
 const after=options['--mode']==='apply'?await auditPasswordCredentialMigration(connection):before;
 const report={at:new Date().toISOString(),scope:options['--mode']==='apply'?'ISOLATED_TEST_BACKFILL':'CONFIGURED_DATABASE_READONLY_AUDIT',databaseName,mode:options['--mode'],copied,unchanged,before,after,note:'No user ID, identifier, role, membership, session or business data changes; no hashes in report. Production execution/release evidence remains separate.'};
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({out,mode:report.mode,copied,unchanged,expanded:after.expanded,missingUsers:after.missingUsers,blockers:after.blockers,readyForUnified:after.readyForUnified}));
}catch(error){console.error(error?.message==='PASSWORD_BACKFILL_BLOCKED_BY_AUDIT'?error.message:typeof error?.code==='string'?error.code:'PASSWORD_MIGRATION_FAILED');process.exitCode=1;}
finally{await pool?.end();await connection?.end();}
