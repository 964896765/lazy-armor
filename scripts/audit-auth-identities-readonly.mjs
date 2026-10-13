import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--env'||args[2]!=='--out') throw new Error('Use --env ENV_FILE --out FRESH_PRIVATE_REPORT');
const out=path.resolve(root,args[3]);
if(existsSync(out)||!out.startsWith(path.join(root,'artifacts')+path.sep)) throw new Error('Fresh private artifacts report required');
const require=createRequire(path.join(root,'apps/api/package.json'));
const env=require('dotenv').parse(readFileSync(path.resolve(root,args[1])));
if(!env.DATABASE_URL || new URL(env.DATABASE_URL).protocol!=='mysql:')throw new Error('Explicit configured MySQL URL required');
const salt=randomBytes(32);
const fingerprint=value=>createHmac('sha256',salt).update(value).digest('hex').slice(0,20);
let connection;
try{
 connection=await require('mysql2/promise').createConnection({uri:env.DATABASE_URL,timezone:'Z'});
 await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 const [passwords]=await connection.query('SELECT BIN_TO_UUID(user_id) AS userId,email,email_verified_at AS verifiedAt FROM auth_identities');
 const [identifiers]=await connection.query('SELECT BIN_TO_UUID(user_id) AS userId,kind,identifier,verified_at AS verifiedAt FROM login_identifiers');
 const [users]=await connection.query('SELECT status,COUNT(*) AS count FROM users GROUP BY status');
 const [sessions]=await connection.query('SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6)');
 await connection.rollback();
 const groups=new Map(), noncanonical=[];
 function add(kind,value,owner,source){
  const normalized=kind==='email'?value.trim().toLowerCase():kind==='phone'?'+86'+value.trim().replace(/^\+86/,''):value;
  const key=kind+':'+normalized;
  if(value!==normalized) noncanonical.push({fingerprint:fingerprint(key),kind,source});
  const group=groups.get(key)??{kind,owners:new Set(),sources:new Set(),rows:0};
  group.owners.add(owner);group.sources.add(source);group.rows++;groups.set(key,group);
 }
 for(const row of passwords)add('email',row.email,row.userId,'legacy-password');
 for(const row of identifiers)add(row.kind,row.identifier,row.userId,'verified-identifier');
 const conflicts=[...groups].filter(([,group])=>group.owners.size>1).map(([key,group])=>({fingerprint:fingerprint(key),kind:group.kind,ownerCount:group.owners.size,sources:[...group.sources],rows:group.rows}));
 const report={at:new Date().toISOString(),readOnly:true,scope:'LOCAL_CONFIGURED_DATABASE_SNAPSHOT',users,passwordIdentities:passwords.length,unverifiedPasswordEmails:passwords.filter(row=>!row.verifiedAt).length,verifiedIdentifiers:identifiers.length,activeSessions:Number(sessions[0].count),conflictCount:conflicts.length,noncanonicalCount:noncanonical.length,conflicts,noncanonical,decision:conflicts.length||noncanonical.length?'MANUAL_REVIEW_REQUIRED':'NO_MAPPING_CONFLICT_OBSERVED',note:'No reassignment or account merge. This snapshot does not prove production migration readiness.'};
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({out,readOnly:true,conflictCount:report.conflictCount,noncanonicalCount:report.noncanonicalCount,passwordIdentities:report.passwordIdentities,verifiedIdentifiers:report.verifiedIdentifiers,unverifiedPasswordEmails:report.unverifiedPasswordEmails}));
}catch(error){console.error(typeof error?.code==='string'?error.code:'READ_ONLY_AUTH_AUDIT_FAILED');process.exitCode=1;}
finally{await connection?.end();}
