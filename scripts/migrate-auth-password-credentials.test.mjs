import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
for(const probe of [
 {name:'rejects primary database apply before connecting',url:'mysql://fixture@127.0.0.1:65534/lazy_armor',expected:'lazy_armor',message:/Apply is restricted/},
 {name:'rejects a mismatched expected database before connecting',url:'mysql://fixture@127.0.0.1:65534/lazy_armor_guard_test',expected:'lazy_armor_other_test',message:/Exact expected MySQL database/},
]){
 test(probe.name,()=>{
  const folder=path.join(root,'artifacts','password-migration-guard-'+randomUUID());
  mkdirSync(folder,{recursive:true});const env=path.join(folder,'fixture.env'),out=path.join(folder,'report.json');
  writeFileSync(env,'DATABASE_URL='+probe.url+'\n',{flag:'wx'});
  const result=spawnSync(process.execPath,[path.join(root,'scripts/migrate-auth-password-credentials.mjs'),'--env',env,'--expected-database',probe.expected,'--mode','apply','--out',out],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,probe.message);assert.doesNotMatch(result.stderr,/ECONNREFUSED/);assert.equal(existsSync(out),false);
 });
}
