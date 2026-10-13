import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { PasswordCredentialService } from '../src/auth/password-credential.service';
import { AuditService } from '../src/audit/audit.service';

describe.sequential('M2 password credential compatibility and migration',()=>{
 let app:INestApplication,pool:Pool,service:AuthService,passwords:PasswordCredentialService;
 const previousMode=process.env.AUTH_PASSWORD_CREDENTIAL_MODE,previousRegistration=process.env.PUBLIC_REGISTRATION;
 const password='correct-horse-battery-staple',newPassword='changed-horse-battery-staple';
 const address=()=> 'm2-'+randomUUID()+'@example.test';
 beforeAll(async()=>{
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE='SHADOW';process.env.PUBLIC_REGISTRATION='true';
  ({app,pool}=await bootP2App('auth-m2'));
  service=app.get(AuthService);passwords=app.get(PasswordCredentialService);
  // Nest validates environment once at startup. Exercise rollout variants via
  // this one fixture provider rather than pretending live env changes deploy flags.
  vi.spyOn(passwords,'mode').mockImplementation(()=>process.env.AUTH_PASSWORD_CREDENTIAL_MODE as 'LEGACY'|'SHADOW'|'UNIFIED');
 });
 afterAll(async()=>{vi.restoreAllMocks();await pool?.end();await app?.close();if(previousMode===undefined)delete process.env.AUTH_PASSWORD_CREDENTIAL_MODE;else process.env.AUTH_PASSWORD_CREDENTIAL_MODE=previousMode;if(previousRegistration===undefined)delete process.env.PUBLIC_REGISTRATION;else process.env.PUBLIC_REGISTRATION=previousRegistration;});
 async function register(mode:'LEGACY'|'SHADOW'|'UNIFIED'='SHADOW'){
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE=mode;
  const email=address(),result=await service.register({email,password,displayName:'Migration fixture'});
  return {...result,email};
 }
 async function records(userId:string){
  const [legacy]=await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,password_hash FROM auth_identities WHERE user_id=UUID_TO_BIN(?)',[userId]);
  const [modern]=await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,BIN_TO_UUID(source_legacy_identity_id) AS source,password_hash,algorithm,parameters_json,version FROM password_credentials WHERE user_id=UUID_TO_BIN(?)',[userId]);
  return {legacy:legacy[0],modern:modern[0]};
 }
 async function sessionCount(userId:string){const [rows]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=UUID_TO_BIN(?)',[userId]);return Number(rows[0].n);}
 async function token(userId:string){
  const value=randomBytes(32).toString('hex');
  await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[userId]);
  await pool.execute('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE),UTC_TIMESTAMP(6))',[randomUUID(),userId,createHash('sha256').update(value).digest('hex')]);
  return value;
 }
 async function phone(userId:string){
  const suffix=String(Math.floor(Math.random()*100000000)).padStart(8,'0'),value='+86139'+suffix;
  await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'phone',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),userId,value]);
  return value;
 }
 it('LEGACY keeps email/password compatibility and suppresses phone password capability',async()=>{
  const s=await register('LEGACY'),value=await phone(s.userId);
  expect((await records(s.userId)).modern).toBeUndefined();
  expect(service.loginMethods().passwordIdentifiers).toEqual(['email']);
  const r=await request(app.getHttpServer()).post('/api/auth/login').send({email:' '+s.email.toUpperCase()+' ',password}).expect(201);expect(r.body.userId).toBe(s.userId);
  await request(app.getHttpServer()).post('/api/auth/login').send({kind:'phone',identifier:value,password}).expect(401);
 });
 it('SHADOW dual-writes a user credential and compares it without changing User ID',async()=>{
  const s=await register(),rows=await records(s.userId);
  expect(rows.modern.password_hash===rows.legacy.password_hash).toBe(true);
  expect(rows.modern.source).toBe(rows.legacy.id);expect(rows.modern.version).toBe(1);expect(rows.modern.algorithm).toBe('bcrypt');expect(rows.modern.parameters_json).toEqual({cost:12});
  const methods=await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(200);
  expect(methods.body.passwordConfigured).toBe(true);
  expect(JSON.stringify(methods.body)).not.toMatch(/password_hash|parameters_json|credentialId/);
  expect((await service.login({email:s.email,password},{ip:'m2-shadow'})).userId).toBe(s.userId);
 });
 it('copies a legacy hash once and preserves its source ID and password',async()=>{
  const s=await register('LEGACY'),before=await records(s.userId);process.env.AUTH_PASSWORD_CREDENTIAL_MODE='SHADOW';
  expect(await passwords.backfillUser(s.userId)).toMatchObject({migrated:true});
  expect(await passwords.backfillUser(s.userId)).toMatchObject({migrated:false,reason:'ALREADY_MIGRATED'});
  const after=await records(s.userId);expect(after.legacy.password_hash===before.legacy.password_hash).toBe(true);expect(after.modern.password_hash===before.legacy.password_hash).toBe(true);
  expect(after.modern.source).toBe(before.legacy.id);expect(after.modern.version).toBe(1);
  const [rows]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='PASSWORD_CREDENTIAL_BACKFILLED'",[s.userId]);expect(Number(rows[0].n)).toBe(1);
 });
 it('concurrent backfill is idempotent under the original user lock',async()=>{
  const s=await register('LEGACY');process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';
  const results=await Promise.all(Array.from({length:4},()=>passwords.backfillUser(s.userId)));
  expect(results.filter(result=>result.migrated)).toHaveLength(1);expect((await records(s.userId)).modern.version).toBe(1);
 });
 it('shadow mismatch refuses session issuance and never overwrites either hash',async()=>{
  const s=await register(),before=await records(s.userId),sessions=await sessionCount(s.userId);
  const {hash}=await import('bcryptjs'),different=await hash(newPassword,12);
  await pool.execute('UPDATE password_credentials SET password_hash=? WHERE user_id=UUID_TO_BIN(?)',[different,s.userId]);
  try{await request(app.getHttpServer()).post('/api/auth/login').send({email:s.email,password}).expect(401);expect(await sessionCount(s.userId)).toBe(sessions);const rows=await records(s.userId);expect(rows.legacy.password_hash===before.legacy.password_hash).toBe(true);expect(rows.modern.password_hash===different).toBe(true);}
  finally{await pool.execute('UPDATE password_credentials SET password_hash=? WHERE user_id=UUID_TO_BIN(?)',[before.modern.password_hash,s.userId]);}
 });
 it.each(['SHADOW','UNIFIED'] as const)('%s refuses unsupported credential algorithms',async mode=>{
  const s=await register(mode);await pool.execute("UPDATE password_credentials SET algorithm='argon2id' WHERE user_id=UUID_TO_BIN(?)",[s.userId]);
  try{await request(app.getHttpServer()).post('/api/auth/login').send({email:s.email,password}).expect(401);}
  finally{await pool.execute("UPDATE password_credentials SET algorithm='bcrypt' WHERE user_id=UUID_TO_BIN(?)",[s.userId]);}
 });
 it.each(['SHADOW','UNIFIED'] as const)('%s changes both hashes and the version in the same transaction',async mode=>{
  const s=await register(mode);await service.changePassword(s.userId,{oldPassword:password,newPassword});
  const rows=await records(s.userId);expect(rows.modern.password_hash===rows.legacy.password_hash).toBe(true);expect(rows.modern.version).toBe(2);
  await expect(service.verifyToken(s.accessToken)).rejects.toThrow();
  await expect(service.login({email:s.email,password},{ip:'m2-old-'+mode})).rejects.toThrow();
  expect((await service.login({email:s.email,password:newPassword},{ip:'m2-new-'+mode})).userId).toBe(s.userId);
 });
 it.each(['SHADOW','UNIFIED'] as const)('%s reset race succeeds once and keeps both stores consistent',async mode=>{
  const s=await register(mode),value=await token(s.userId);
  const results=await Promise.allSettled([service.resetPassword({token:value,newPassword}),service.resetPassword({token:value,newPassword:newPassword+'2'})]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const rows=await records(s.userId);expect(rows.modern.password_hash===rows.legacy.password_hash).toBe(true);expect(rows.modern.version).toBe(2);
  await expect(service.refresh(s.refreshToken,{})).rejects.toThrow();
 });
 it('audit failure rolls back both passwords, version, reset token and session revocation',async()=>{
  const s=await register(),value=await token(s.userId),before=await records(s.userId),audit=app.get(AuditService),append=audit.append.bind(audit);
  const spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='PASSWORD_RESET_COMPLETED')throw new Error('M2 fixture audit failure');return append(entry,tx);});
  try{await expect(service.resetPassword({token:value,newPassword})).rejects.toThrow('M2 fixture audit failure');}finally{spy.mockRestore();}
  const rows=await records(s.userId);expect(rows.legacy.password_hash===before.legacy.password_hash).toBe(true);expect(rows.modern.password_hash===before.modern.password_hash).toBe(true);expect(rows.modern.version).toBe(1);
  expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
  const [tokens]=await pool.execute<RowDataPacket[]>('SELECT used_at FROM password_reset_tokens WHERE token_hash=?',[createHash('sha256').update(value).digest('hex')]);expect(tokens[0].used_at).toBeNull();
  await service.resetPassword({token:value,newPassword});
 });
 it('a credential version change invalidates an in-flight proof even if the hash is unchanged',async()=>{
  const s=await register('UNIFIED');let release!:()=>void,reached!:()=>void;
  const [before]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_SUCCESS'",[s.userId]);
  const gate=new Promise<void>(resolve=>{release=resolve;}),observed=new Promise<void>(resolve=>{reached=resolve;});
  const original=(service as any).issueTokens.bind(service);
  const spy=vi.spyOn(service as any,'issueTokens').mockImplementation(async(...args:any[])=>{reached();await gate;return original(...args);});
  const pending=service.login({email:s.email,password},{ip:'m2-stale-version'});
  await observed;await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);release();
  try{await expect(pending).rejects.toThrow();}finally{spy.mockRestore();}
  const [after]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_SUCCESS'",[s.userId]);expect(Number(after[0].n)).toBe(Number(before[0].n));
 });
 it('multiple legacy passwords require manual review and are not collapsed',async()=>{
  const s=await register('LEGACY'),second=randomUUID(),old=await records(s.userId);
  await pool.execute('INSERT INTO auth_identities(id,user_id,email,password_hash,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))',[second,s.userId,address(),old.legacy.password_hash]);
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE='SHADOW';
  try{await expect(passwords.backfillUser(s.userId)).rejects.toMatchObject({response:{code:'PASSWORD_CREDENTIAL_CONFLICT'}});expect((await records(s.userId)).modern).toBeUndefined();}
  finally{await pool.execute('DELETE FROM auth_identities WHERE id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?)',[second,s.userId]);}
 });
 it('UNIFIED lazily copies old credentials and verified phone/email aliases enter the same account',async()=>{
  const s=await register('LEGACY'),value=await phone(s.userId),alias=address();
  await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'email',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),s.userId,alias]);
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';
  const mobile=await request(app.getHttpServer()).post('/api/auth/login').send({kind:'phone',identifier:value.replace('+86',''),password}).expect(201);
  const email=await request(app.getHttpServer()).post('/api/auth/login').send({kind:'email',identifier:alias.toUpperCase(),password}).expect(201);
  expect(mobile.body.userId).toBe(s.userId);expect(email.body.userId).toBe(s.userId);expect((await records(s.userId)).modern.version).toBe(1);
  expect(service.loginMethods().passwordIdentifiers).toEqual(['email','phone']);
 });
 it('unbound phone, missing password and client-selected User ID cannot create or select accounts',async()=>{
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';
  const phoneOnly=await service.loginVerified('phone','+8613800000088',{});
  await request(app.getHttpServer()).post('/api/auth/login').send({kind:'phone',identifier:'+8613800000088',password}).expect(401);
  await request(app.getHttpServer()).post('/api/auth/login').send({kind:'phone',identifier:'+8613800000099',password}).expect(401);
  await request(app.getHttpServer()).post('/api/auth/login').send({email:address(),password,userId:phoneOnly.userId}).expect(400);
  await request(app.getHttpServer()).post('/api/auth/login').send({email:address(),identifier:address(),password}).expect(400);
  const [rows]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM login_identifiers WHERE kind='phone' AND identifier='+8613800000099'");expect(Number(rows[0].n)).toBe(0);
 });
 it('a proof belonging to another user cannot issue the target user session',async()=>{
  const target=await register('UNIFIED'),other=await register('UNIFIED'),snapshot=await passwords.observe(other.userId),before=await sessionCount(target.userId);
  await expect((service as any).issueTokens(target.userId,null,{kind:'email',identifier:target.email,snapshot})).rejects.toThrow();
  expect(await sessionCount(target.userId)).toBe(before);
 });
 it('disabled users remain disabled after backfill and cannot use phone password login',async()=>{
  const s=await register('LEGACY'),value=await phone(s.userId);await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
  process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';await passwords.backfillUser(s.userId);
  await request(app.getHttpServer()).post('/api/auth/login').send({kind:'phone',identifier:value,password}).expect(401);
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT status,role FROM users WHERE id=UUID_TO_BIN(?)',[s.userId]);expect(rows[0]).toMatchObject({status:'disabled',role:'user'});
 });

 it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('exported Web phone password login uses the original User ID and real security capability',async()=>{
  const s=await register('UNIFIED'),value=await phone(s.userId);
  await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
  const {chromium}=await import('playwright-core'),{createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path');
  const root=path.resolve(process.cwd(),'../..'),dist=path.join(root,'apps/mobile/dist'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
  await app.listen(0,'127.0.0.1');const apiBase=await app.getUrl();
  const server=createServer((req,res)=>{
   const requested=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url!,'http://localhost').pathname));
   const file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');
   res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();let signedInUser='';
   await page.route('http://127.0.0.1:3001/api/**',async route=>{
    const target=new URL(route.request().url()),response=await route.fetch({url:apiBase+target.pathname+target.search});
    if(target.pathname==='/api/auth/login'&&response.status()===201)signedInUser=(await response.json()).userId;
    await route.fulfill({response});
   });
   await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/auth/password-login');
   await page.getByRole('tab',{name:'手机号',exact:true}).click();
   await page.getByLabel('手机号账号',{exact:true}).fill(value.replace('+86',''));
   await page.getByLabel('密码',{exact:true}).fill(password);
   await page.screenshot({path:path.join(screenshots,'m2-phone-password.png'),fullPage:true});
   await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/schedule');
   expect(signedInUser).toBe(s.userId);
   await page.getByRole('button',{name:'我的',exact:true}).first().click();
   await page.getByRole('button',{name:/账号与登录/}).click();
   await page.getByText('当前账号的登录方式共用此密码',{exact:true}).filter({visible:true}).first().waitFor();
   await page.screenshot({path:path.join(screenshots,'m2-phone-security.png'),fullPage:true});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   await context.close();
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 },90000);

 it('backfill audit failure creates no partial mirror and permits a safe retry',async()=>{
  const s=await register('LEGACY');process.env.AUTH_PASSWORD_CREDENTIAL_MODE='SHADOW';
  const audit=app.get(AuditService),append=audit.append.bind(audit);
  const spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='PASSWORD_CREDENTIAL_BACKFILLED')throw new Error('M2 backfill failure');return append(entry,tx);});
  try{await expect(passwords.backfillUser(s.userId)).rejects.toThrow('M2 backfill failure');}finally{spy.mockRestore();}
  expect((await records(s.userId)).modern).toBeUndefined();expect(await passwords.backfillUser(s.userId)).toMatchObject({migrated:true});
 });
});
