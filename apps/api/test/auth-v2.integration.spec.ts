import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { IdentityResolverService } from '../src/auth/identity-resolver.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { AuditService } from '../src/audit/audit.service';

describe.sequential('Auth V2 isolated identity and transaction regressions',()=>{
 let app:INestApplication, pool:Pool, service:AuthService, identities:IdentityResolverService, codes:LoginCodeService, redis:IORedis;
 const deliveries=new Map<string,string>();
 const password='correct-horse-battery-staple', changed='new-correct-horse-battery-staple';
 const environmentKeys=['EMAIL_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION'] as const;
 const originalEnvironment=Object.fromEntries(environmentKeys.map(key=>[key,process.env[key]]));
 let serial=0;
 const email=()=> 'auth-v2-'+randomUUID()+'@example.test';
 beforeAll(async()=>{
  process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT='https://auth-delivery.fixture.test';
  process.env.LOGIN_CODE_DELIVERY_TOKEN='private-fixture-delivery-token';
  process.env.PUBLIC_REGISTRATION='true';
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
   if(String(url)!==process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT) throw new Error('Unexpected outbound request');
   expect(options.redirect).toBe('error');
   const body=JSON.parse(String(options.body));
   deliveries.set(body.purpose+':'+body.recipient,body.code);
   return {ok:true};
  }));
  ({app,pool}=await bootP2App('auth-v2'));
  service=app.get(AuthService);identities=app.get(IdentityResolverService);codes=app.get(LoginCodeService);
  redis=new IORedis(process.env.REDIS_URL!);
 });
 afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();for(const key of environmentKeys){const value=originalEnvironment[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 async function legacy(address=email()){
  const r=await request(app.getHttpServer()).post('/api/auth/register').send({email:address,password,displayName:'Auth fixture'}).expect(201);
  return {...r.body,email:address};
 }
 async function code(address:string, scope?:{purpose:'email-bind'|'password-set';userId:string}){
  const result=await codes.request({kind:'email',identifier:address},'fixture-send-'+(++serial),scope);
  expect(result).not.toHaveProperty('code');
  return deliveries.get((scope?.purpose??'login')+':'+address)!;
 }
 async function otp(address:string){
  const value=await code(address);
  return request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:address,code:value});
 }
 async function resetToken(userId:string,expires='DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE)',verified=true){
  if(verified)await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[userId]);
  const token=randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?, '+expires+',UTC_TIMESTAMP(6))',[randomUUID(),userId,createHash('sha256').update(token).digest('hex')]);
  return token;
 }
 async function count(table:string){const [rows]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM '+table);return Number(rows[0].n);}
 async function unused(token:string){const [rows]=await pool.execute<RowDataPacket[]>('SELECT used_at FROM password_reset_tokens WHERE token_hash=?',[createHash('sha256').update(token).digest('hex')]);return rows[0].used_at===null;}

 it('email OTP first rejects duplicate password registration and adds optional password to same User ID',async()=>{
  const address=email(), session=await otp(address);expect(session.status).toBe(201);
  await request(app.getHttpServer()).post('/api/auth/register').send({email:address.toUpperCase(),password,displayName:'Duplicate'}).expect(409);
  const methods=await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(session.body.accessToken)).expect(200);
  expect(methods.body).toMatchObject({passwordConfigured:false,canSetPassword:true});
  expect(JSON.stringify(methods.body)).not.toContain(address);
  // Use a fresh purpose-bound challenge without waiting on the identifier-wide cooldown.
  const challengeKey=(codes as any).challengeKey('email',address,{purpose:'password-set',userId:session.body.userId});
  const value='723401';
  await redis.set(challengeKey,(codes as any).digest(challengeKey+':'+value),'EX',300);
  await request(app.getHttpServer()).post('/api/auth/password/set').set(auth(session.body.accessToken)).send({email:address,code:value,newPassword:password}).expect(201);
  const login=await service.login({email:address,password},{ip:'fixture-password'});
  expect(login.userId).toBe(session.body.userId);
  expect((await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(login.accessToken))).body.passwordConfigured).toBe(true);
 });
 it('legacy unverified email requires current account password plus inbox proof, then OTP reuses its ID',async()=>{
  const s=await legacy(), attempted=await otp(s.email);
  expect(attempted.status).toBe(409);expect(attempted.body.code).toBe('EMAIL_PROOF_REQUIRED');
  await request(app.getHttpServer()).post('/api/auth/identifiers/bind/request').set(auth(s.accessToken)).send({email:s.email,password:'wrong'}).expect(401);
  const scope={purpose:'email-bind' as const,userId:s.userId}, key=(codes as any).challengeKey('email',s.email,scope), value='821750';
  await redis.set(key,(codes as any).digest(key+':'+value),'EX',300);
  await request(app.getHttpServer()).post('/api/auth/identifiers/bind/confirm').set(auth(s.accessToken)).send({email:s.email,password,code:value}).expect(201);
  const resolved=await service.loginVerified('email',s.email.toUpperCase(),{});
  expect(resolved.userId).toBe(s.userId);expect(resolved.firstLogin).toBe(false);
 });
 it('previously verified password identity preserves the original User ID',async()=>{
  const s=await legacy();await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
  expect((await service.loginVerified('email',s.email,{})).userId).toBe(s.userId);
 });
 it('concurrent password and OTP creation leaves one user/profile/membership without orphan accounts',async()=>{
  for(let i=0;i<4;i++){
   const address=email(), before=await Promise.all(['users','profiles','user_memberships'].map(count));
   const outcomes=await Promise.allSettled([service.register({email:address,password,displayName:'Race'}),service.loginVerified('email',address,{})]);
   expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   expect(await Promise.all(['users','profiles','user_memberships'].map(count))).toEqual(before.map(n=>n+1));
  }
 });
 it.each(['email','phone'] as const)('concurrent %s first verification reuses a single account',async kind=>{
  const value=kind==='email'?email():'+8613912345678', before=await count('users');
  const sessions=await Promise.all(Array.from({length:3},()=>service.loginVerified(kind,value,{})));
  expect(new Set(sessions.map(s=>s.userId)).size).toBe(1);expect(await count('users')).toBe(before+1);
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT role FROM users WHERE id=UUID_TO_BIN(?)',[sessions[0].userId]);expect(rows[0].role).toBe('user');
 });
 it('historical conflicting IDs fail closed and are never reassigned',async()=>{
  const a=await legacy(), b=await legacy();
  await pool.execute('INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),\'email\',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))',[randomUUID(),b.userId,a.email]);
  const before=await count('users');
  await expect(service.loginVerified('email',a.email,{})).rejects.toMatchObject({response:{code:'IDENTITY_CONFLICT'}});
  await expect(service.login({email:a.email,password},{ip:'fixture-conflict'})).rejects.toThrow();
  expect(await count('users')).toBe(before);
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(user_id) AS owner FROM login_identifiers WHERE identifier=?',[a.email]);expect(rows[0].owner).toBe(b.userId);
 });
 it('does not accept another account, login purpose or password purpose for legacy verification',async()=>{
  const a=await legacy(), b=await legacy(), value=await code(email());
  await request(app.getHttpServer()).post('/api/auth/identifiers/bind/confirm').set(auth(b.accessToken)).send({email:a.email,password,code:value}).expect(401);
  const address=email(), otpCode=await code(address);
  await expect(codes.verify({kind:'email',identifier:address,code:otpCode},'fixture-verify',{purpose:'password-set',userId:a.userId})).rejects.toThrow();
  expect(await codes.verify({kind:'email',identifier:address,code:otpCode},'fixture-verify')).toBe(address);
  await expect(codes.verify({kind:'email',identifier:address,code:otpCode},'fixture-verify')).rejects.toThrow();
 });
 it('enforces a send budget shared by login and credential purposes and a 5 minute TTL',async()=>{
  const address=email();await code(address);
  await expect(codes.request({kind:'email',identifier:address},'fixture-other',{purpose:'password-set',userId:randomUUID()})).rejects.toMatchObject({status:429});
  expect(await redis.ttl((codes as any).key('email',address))).toBeGreaterThan(290);
 });
 it('concurrent reset claims succeed once and revoke every old access and refresh session',async()=>{
  const s=await legacy(), second=await service.login({email:s.email,password},{ip:'fixture-reset'});
  const token=await resetToken(s.userId);
  const results=await Promise.allSettled([service.resetPassword({token,newPassword:changed}),service.resetPassword({token,newPassword:changed+'2'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await unused(token)).toBe(false);
  for(const old of [s,second]) {await expect(service.verifyToken(old.accessToken)).rejects.toThrow();await expect(service.refresh(old.refreshToken,{})).rejects.toThrow();}
  await expect(service.resetPassword({token,newPassword:password})).rejects.toThrow();
 });
 it('expired reset links cannot change passwords',async()=>{
  const s=await legacy(), token=await resetToken(s.userId,'DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND)');
  await expect(service.resetPassword({token,newPassword:changed})).rejects.toThrow();
  expect((await service.login({email:s.email,password},{ip:'fixture-expired'})).userId).toBe(s.userId);
 });
 it('unverified legacy email cannot be used for anonymous recovery, including a previously issued link',async()=>{
  const s=await legacy(),token=await resetToken(s.userId,undefined,false);
  const delivery=vi.spyOn((service as any).resetDelivery,'deliver');
  try{expect(await service.forgotPassword(s.email,{ip:'fixture-unverified-recovery'})).toEqual({requested:true});expect(delivery).not.toHaveBeenCalled();}finally{delivery.mockRestore();}
  await expect(service.resetPassword({token,newPassword:changed})).rejects.toThrow();
  expect(await unused(token)).toBe(true);
  expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
 });
 it('rejects new passwords beyond bcrypt byte capacity before creating an account',async()=>{
  const before=await count('users');
  for(const long of ['x'.repeat(73),'中'.repeat(25)])await request(app.getHttpServer()).post('/api/auth/register').send({email:email(),password:long,displayName:'Length fixture'}).expect(400);
  expect(await count('users')).toBe(before);
 });
 it('a password change during recovery delivery prevents late reset token issuance',async()=>{
  const s=await legacy();await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
  let release!:()=>void,observed!:()=>void,raw='';
  const reached=new Promise<void>(resolve=>{observed=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const spy=vi.spyOn((service as any).resetDelivery,'deliver').mockImplementation(async(input:any)=>{raw=input.token;observed();await gate;return 'delivered';});
  const pending=service.forgotPassword(s.email,{ip:'fixture-late-recovery'});
  await reached;await service.changePassword(s.userId,{oldPassword:password,newPassword:changed});release();
  try{expect(await pending).toEqual({requested:true});}finally{spy.mockRestore();}
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE token_hash=?',[createHash('sha256').update(raw).digest('hex')]);
  expect(Number(rows[0].n)).toBe(0);
 });
 it('audit failure rolls back password, token claim and revocation; valid token can retry',async()=>{
  const s=await legacy(), token=await resetToken(s.userId), audit=app.get(AuditService), append=audit.append.bind(audit);
  const spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='PASSWORD_RESET_COMPLETED')throw new Error('Fixture audit failure');return append(entry,tx);});
  try{await expect(service.resetPassword({token,newPassword:changed})).rejects.toThrow('Fixture audit failure');}finally{spy.mockRestore();}
  expect(await unused(token)).toBe(true);expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
  await service.login({email:s.email,password},{ip:'fixture-rollback'});
  await service.resetPassword({token,newPassword:changed});
  await expect(service.verifyToken(s.accessToken)).rejects.toThrow();
 });
 it('in-flight old password proof cannot issue a session after reset',async()=>{
  const s=await legacy(), token=await resetToken(s.userId);
  let release!:()=>void, observed!:()=>void;
  const reached=new Promise<void>(resolve=>{observed=resolve;}), gate=new Promise<void>(resolve=>{release=resolve;});
  const original=(service as any).issueTokens.bind(service);
  const spy=vi.spyOn(service as any,'issueTokens').mockImplementation(async(...args:any[])=>{observed();await gate;return original(...args);});
  const pending=service.login({email:s.email,password},{ip:'fixture-stale-password'});
  await reached;await service.resetPassword({token,newPassword:changed});release();
  try{await expect(pending).rejects.toThrow();}finally{spy.mockRestore();}
  const [rows]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=UUID_TO_BIN(?) AND revoked_at IS NULL',[s.userId]);expect(Number(rows[0].n)).toBe(0);
 });
 it('in-flight refresh cannot replace a revoked session after reset',async()=>{
  const s=await legacy(), token=await resetToken(s.userId);
  let release!:()=>void, observed!:()=>void;
  const reached=new Promise<void>(resolve=>{observed=resolve;}), gate=new Promise<void>(resolve=>{release=resolve;});
  const original=(service as any).rotateSession.bind(service);
  const spy=vi.spyOn(service as any,'rotateSession').mockImplementation(async(...args:any[])=>{observed();await gate;return original(...args);});
  const pending=service.refresh(s.refreshToken,{});await reached;await service.resetPassword({token,newPassword:changed});release();
  try{await expect(pending).rejects.toThrow();}finally{spy.mockRestore();}
 });

 it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real exported Web UI verifies legacy email and preserves chat draft during token refresh',async()=>{
  const {chromium}=await import('playwright-core');
  const {createServer}=await import('node:http');
  const {readFileSync,existsSync}=await import('node:fs');
  const path=await import('node:path');
  const root=path.resolve(process.cwd(),'../..'), dist=path.join(root,'apps/mobile/dist'), screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
  const s=await legacy();
  const {AiProviderConfigService}=await import('../src/ai-provider-config/ai-provider-config.service');
  // Isolated encrypted fixture only; no model test or message is submitted.
  await app.get(AiProviderConfigService).save(s.userId,{model:'deepseek-flash',thinkingMode:'AUTO',apiKey:'auth-ui-fixture-credential'});
  const originalTtl=(service as any).accessTtlSeconds;
  (service as any).accessTtlSeconds=150;
  await app.listen(0,'127.0.0.1');
  const apiBase=await app.getUrl();
  const server=createServer((req,res)=>{
   const requested=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url!,'http://localhost').pathname));
   const target=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');
   res.setHeader('content-type',target.endsWith('.js')?'application/javascript':target.endsWith('.png')?'image/png':target.endsWith('.ttf')?'font/ttf':'text/html');
   res.end(readFileSync(target));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const webBase='http://127.0.0.1:'+(server.address() as any).port;
  const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   const page=await context.newPage();
   await page.route('http://127.0.0.1:3001/api/**',async route=>{
    const response=await route.fetch({url:apiBase+new URL(route.request().url()).pathname});
    await route.fulfill({response});
   });
   await page.goto(webBase+'/auth/login');
   await page.getByRole('textbox',{name:'邮箱',exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(screenshots,'mobile-login.png'),fullPage:true});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   await page.setViewportSize({width:1440,height:900});
   await page.screenshot({path:path.join(screenshots,'desktop-login.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.getByRole('link',{name:'使用邮箱密码登录'}).click();
   await page.getByLabel('邮箱账号',{exact:true}).fill(s.email);
   await page.getByLabel('密码',{exact:true}).fill(password);
   await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.getByRole('button',{name:'我的',exact:true}).first().click();
   await page.waitForURL('**/profile');
   await page.getByRole('button',{name:/账号与登录/}).click();
   await page.getByText('待验证',{exact:true}).waitFor();
   await page.getByRole('button',{name:/待验证/}).click();
   await page.getByLabel('当前账号邮箱').fill(s.email);
   await page.getByLabel('当前密码',{exact:true}).fill(password);
   await page.getByRole('button',{name:'获取邮箱验证码',exact:true}).click();
   await page.getByText('验证码已发送到邮箱，5 分钟内有效。',{exact:true}).waitFor();
   await page.getByLabel('邮箱验证码').fill(deliveries.get('email-bind:'+s.email)!);
   await page.getByRole('button',{name:'验证邮箱',exact:true}).click();
   await page.getByText('邮箱已验证，今后可用验证码登录原账号。',{exact:true}).waitFor();
   await page.getByRole('button',{name:'返回账号与验证'}).click();
   await page.getByText('已验证',{exact:true}).filter({visible:true}).first().waitFor();
   await page.screenshot({path:path.join(screenshots,'verified-security.png'),fullPage:true});
   for(let i=0;i<4&&!page.url().endsWith('/schedule');i++)await page.getByRole('button',{name:'返回',exact:true}).first().click();
   await page.getByRole('button',{name:/会话/}).click();
   const draft=page.getByLabel('会话需求',{exact:true}).filter({visible:true});
   await draft.fill('刷新令牌后，这段未发送草稿必须保留。');
   const refresh=await page.waitForResponse(response=>response.url().endsWith('/auth/refresh')&&response.status()===201,{timeout:45000});
   expect(refresh.status()).toBe(201);
   expect(await draft.inputValue()).toBe('刷新令牌后，这段未发送草稿必须保留。');
   await page.screenshot({path:path.join(screenshots,'chat-after-refresh.png'),fullPage:true});
   const recoveryToken=await resetToken(s.userId);
   await page.goto(webBase+'/auth/reset-password?token='+encodeURIComponent(recoveryToken));
   await page.getByLabel('恢复新密码').fill(changed);
   await page.getByLabel('确认恢复密码').fill(changed);
   await page.getByRole('button',{name:'重置并重新登录',exact:true}).click();
   await page.getByRole('textbox',{name:'邮箱账号',exact:true}).waitFor();
   await page.getByLabel('邮箱账号',{exact:true}).fill(s.email);
   await page.getByLabel('密码',{exact:true}).fill(changed);
   await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.waitForURL('**/schedule');
   expect((await service.login({email:s.email,password:changed},{ip:'fixture-recovery-ui'})).userId).toBe(s.userId);
   await context.close();
  }finally{(service as any).accessTtlSeconds=originalTtl;await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 },120000);

 it('inactive accounts cannot login, refresh or mutate credentials',async()=>{
  const s=await legacy();await pool.execute('UPDATE users SET status=\'disabled\' WHERE id=UUID_TO_BIN(?)',[s.userId]);
  await expect(service.login({email:s.email,password},{ip:'fixture-disabled'})).rejects.toThrow();
  await expect(service.refresh(s.refreshToken,{})).rejects.toThrow();
  await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(401);
  await expect(identities.verifyLegacyEmail(s.userId,s.email,'unknown')).rejects.toThrow();
 });
});
