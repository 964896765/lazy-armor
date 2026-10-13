import type { INestApplication } from '@nestjs/common';
import type { Pool,RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { bootP2App,auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { PasswordRecoveryService } from '../src/auth/password-recovery.service';
import { PasswordResetDeliveryService } from '../src/auth/password-reset-delivery.service';
import { RateLimiterService } from '../src/infrastructure/rate-limiter.service';
import { AuditService } from '../src/audit/audit.service';
import { decodeRecoveryToken,encodeRecoveryToken,recoveryTokenHash } from '../src/auth/password-recovery-token';

describe.sequential('M2-03 verified email recovery on real SQL and Redis',()=>{
  let app:INestApplication,pool:Pool,service:AuthService,recovery:PasswordRecoveryService,redis:IORedis,prefix:string;
  const password='correct-horse-battery-staple',changed='new-correct-horse-battery-staple';
  const environmentKeys=['AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_PASSWORD_RECOVERY_MODE','AUTH_EMAIL_BIND_ENABLED','EMAIL_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PASSWORD_RESET_DELIVERY_ENDPOINT','PASSWORD_RESET_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
  const previous=Object.fromEntries(environmentKeys.map(key=>[key,process.env[key]]));
  const deliveries:Array<{email:string;token:string}>=[],codes=new Map<string,string>();
  const email=()=> 'recover-'+randomUUID()+'@example.test';
  const digest=(raw:string)=>raw.startsWith('v2.')?recoveryTokenHash(process.env.JWT_SECRET!,raw):createHash('sha256').update(raw).digest('hex');
  beforeAll(async()=>{
    process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';process.env.AUTH_PASSWORD_RECOVERY_MODE='BOUND';process.env.AUTH_EMAIL_BIND_ENABLED='true';process.env.PUBLIC_REGISTRATION='true';
    process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT=process.env.PASSWORD_RESET_DELIVERY_ENDPOINT='https://recovery-delivery.fixture.test';
    process.env.LOGIN_CODE_DELIVERY_TOKEN=process.env.PASSWORD_RESET_DELIVERY_TOKEN='private-recovery-fixture-token-that-is-longer-than-32';
    prefix=(process.env.REDIS_KEY_PREFIX??'auth-test-'+randomUUID())+':password-recovery';process.env.REDIS_KEY_PREFIX=process.env.TEST_REDIS_KEY_PREFIX=prefix;
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
      if(String(url)!==process.env.PASSWORD_RESET_DELIVERY_ENDPOINT)throw new Error('Unexpected outbound request');
      expect(options.redirect).toBe('error');const body=JSON.parse(String(options.body));
      if(body.type==='password_reset')deliveries.push({email:body.recipientEmail,token:new URL(body.resetUrl).searchParams.get('token')!});
      else if(body.type==='login_code')codes.set(body.purpose+':'+body.recipient,body.code);
      else throw new Error('Unexpected delivery type');
      return {ok:true};
    }));
    ({app,pool}=await bootP2App('password-recovery'));service=app.get(AuthService);recovery=app.get(PasswordRecoveryService);redis=new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async()=>{const keys=await redis.keys(prefix+':ratelimit:*');if(keys.length)await redis.del(...keys);});
  afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();for(const key of environmentKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const post=(path:string,body:unknown)=>request(app.getHttpServer()).post('/api/auth/'+path).send(body);
  async function account(){const address=email();return {...await service.register({email:address,password,displayName:'Recovery fixture'}),email:address};}
  async function alias(s:{accessToken:string},target=email()){
    const start=await post('email-binding/start',{email:target,proof:'password',password}).set(auth(s.accessToken)).expect(201),challenge=start.body.challenge;
    await post('email-binding/target/request',{challenge}).set(auth(s.accessToken)).expect(201);
    await post('email-binding/confirm',{challenge,code:codes.get('email-bind-target:'+target)}).set(auth(s.accessToken)).expect(201);
    return target;
  }
  async function verifiedCanonical(s:{userId:string;email:string}){await pool.execute('UPDATE auth_identities SET email_verified_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?)',[s.userId]);}
  async function issue(address:string){const before=deliveries.length;const r=await post('forgot-password',{email:address}).expect(201);expect(r.body).toEqual({requested:true});return deliveries.length>before?deliveries.at(-1)!.token:undefined;}
  async function tokenRow(raw:string){const [rows]=await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,BIN_TO_UUID(user_id) AS userId,used_at,expires_at FROM password_reset_tokens WHERE token_hash=?',[digest(raw)]);return rows[0];}
  async function oldToken(userId:string){const raw=randomBytes(32).toString('hex');await pool.execute('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE),UTC_TIMESTAMP(6))',[randomUUID(),userId,digest(raw)]);return raw;}
  async function state(userId:string){
    const [old]=await pool.execute<RowDataPacket[]>('SELECT password_hash,email_verified_at FROM auth_identities WHERE user_id=UUID_TO_BIN(?)',[userId]);
    const [modern]=await pool.execute<RowDataPacket[]>('SELECT password_hash,version FROM password_credentials WHERE user_id=UUID_TO_BIN(?)',[userId]);
    const [profile]=await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,display_name FROM profiles WHERE user_id=UUID_TO_BIN(?)',[userId]);
    return {old:old[0],modern:modern[0],profile};
  }
  function reset(raw:string,next=changed){return post('reset-password',{token:raw,newPassword:next});}

  it('a safely bound alias resets the same account without verifying or replacing the legacy email',async()=>{
    const s=await account(),address=await alias(s),before=await state(s.userId),second=await service.login({email:s.email,password},{}),raw=(await issue(address))!;
    expect(raw.startsWith('v2.')).toBe(true);expect((await tokenRow(raw)).userId).toBe(s.userId);
    await reset(raw).expect(201);const after=await state(s.userId);
    expect(after.modern.version).toBe(2);expect(after.modern.password_hash===after.old.password_hash).toBe(true);expect(after.old.email_verified_at).toBeNull();expect(after.profile).toEqual(before.profile);
    for(const old of [s,second]){await expect(service.verifyToken(old.accessToken)).rejects.toThrow();await expect(service.refresh(old.refreshToken,{})).rejects.toThrow();}
    await expect(service.login({email:s.email,password},{})).rejects.toThrow();
    for(const identifier of [s.email,address])expect((await service.login({kind:'email',identifier,password:changed},{})).userId).toBe(s.userId);
  });
  it('a verified canonical legacy email without a login mapping can still recover through a bound link',async()=>{
    const s=await account();await verifiedCanonical(s);const raw=(await issue(s.email))!;
    expect(decodeRecoveryToken(process.env.JWT_SECRET!,raw).source.kind).toBe('legacy');await reset(raw).expect(201);expect((await service.login({email:s.email,password:changed},{})).userId).toBe(s.userId);
  });
  it('verified email aliases share one recovery password and report truthful recovery capability',async()=>{
    const s=await account(),a=await alias(s),b=await alias(s);const m=await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(200);
    expect(m.body.identifiers.filter((item:any)=>item.recoveryEnabled)).toHaveLength(2);
    expect(m.body.identifiers.filter((item:any)=>!item.verified).every((item:any)=>!item.recoveryEnabled)).toBe(true);
    const raw=(await issue(b))!;await reset(raw).expect(201);for(const identifier of [a,b])expect((await service.login({kind:'email',identifier,password:changed},{})).userId).toBe(s.userId);
  });
  it('unknown, unverified, disabled, conflicting and password-free accounts share the response without delivery',async()=>{
    const unverified=await account(),disabled=await account(),conflict=await account(),other=await account(),noPassword=await service.loginVerified('email',email(),{});
    await verifiedCanonical(disabled);await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[disabled.userId]);await verifiedCanonical(conflict);
    await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'email',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),other.userId,conflict.email]);
    const [rows]=await pool.execute<RowDataPacket[]>('SELECT identifier FROM login_identifiers WHERE user_id=UUID_TO_BIN(?)',[noPassword.userId]);const before=deliveries.length;
    for(const address of [email(),unverified.email,disabled.email,conflict.email,rows[0].identifier])expect(await issue(address)).toBeUndefined();expect(deliveries.length).toBe(before);
  });
  it('a shadow credential mismatch does not expose the account or issue recovery',async()=>{
    const s=await account();await verifiedCanonical(s);await pool.execute('UPDATE password_credentials SET source_legacy_identity_id=NULL WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    expect(await issue(s.email)).toBeUndefined();
  });
  it('an old unbound link never revives when the old mailbox becomes verified or a new mailbox is bound',async()=>{
    const s=await account(),raw=await oldToken(s.userId);await alias(s);await verifiedCanonical(s);
    await reset(raw).expect(401);expect((await tokenRow(raw)).used_at).toBeNull();expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
  });
  it('successful recovery issuance supersedes all prior legacy and alias links',async()=>{
    const s=await account(),a=await alias(s),b=await alias(s),legacy=await oldToken(s.userId),first=(await issue(a))!,last=(await issue(b))!;
    expect((await tokenRow(legacy)).used_at).not.toBeNull();expect((await tokenRow(first)).used_at).not.toBeNull();expect((await tokenRow(last)).used_at).toBeNull();
    await reset(first).expect(401);await reset(last).expect(201);
  });
  it('parallel alias requests leave exactly one active link on the original user',async()=>{
    const s=await account(),a=await alias(s),b=await alias(s);await Promise.all([issue(a),issue(b)]);
    const [rows]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id=UUID_TO_BIN(?) AND used_at IS NULL',[s.userId]);expect(Number(rows[0].n)).toBe(1);
  });
  it('one recipient user budget spans different email aliases and rate-limited replies stay uniform',async()=>{
    const s=await account(),addresses=[await alias(s),await alias(s),await alias(s),await alias(s)];
    for(const address of addresses.slice(0,3))expect(await issue(address)).toBeTruthy();expect(await issue(addresses[3])).toBeUndefined();
  });
  it('one address and IP share bounded public request budgets',async()=>{
    const s=await account();await verifiedCanonical(s);for(let i=0;i<3;i++)expect(await issue(s.email)).toBeTruthy();expect(await issue(s.email)).toBeUndefined();
    for(let i=0;i<8;i++)await issue(email());expect(await issue(email())).toBeUndefined();
  });
  it('tampered ciphertext, expiry, identity and credentials cannot change any password',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!,parts=raw.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    await reset(parts.join('.')).expect(401);expect((await tokenRow(raw)).used_at).toBeNull();expect((await service.login({email:s.email,password},{})).userId).toBe(s.userId);
  });
  it.each(['encrypted','sql'] as const)('%s expiry invalidates a bound link',async kind=>{
    const s=await account(),address=await alias(s),original=(await issue(address))!;
    let raw=original;
    if(kind==='sql')await pool.execute('UPDATE password_reset_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE token_hash=?',[digest(original)]);
    else {const context=decodeRecoveryToken(process.env.JWT_SECRET!,original);raw=encodeRecoveryToken(process.env.JWT_SECRET!,{...context,expiresAt:Date.now()-1});}
    await reset(raw).expect(401);expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
  });
  it('changing the row user cannot redirect the encrypted proof to another account',async()=>{
    const a=await account(),b=await account(),address=await alias(a),raw=(await issue(address))!,before=await state(b.userId);
    await pool.execute('UPDATE password_reset_tokens SET user_id=UUID_TO_BIN(?) WHERE token_hash=?',[b.userId,digest(raw)]);await reset(raw).expect(401);
    expect((await state(b.userId)).modern.password_hash===before.modern.password_hash).toBe(true);
  });
  it.each(['owner','address','verification','recreated'] as const)('source %s changes invalidate the frozen mailbox proof',async kind=>{
    const s=await account(),other=await account(),address=await alias(s),raw=(await issue(address))!,context=decodeRecoveryToken(process.env.JWT_SECRET!,raw);
    if(kind==='owner')await pool.execute('UPDATE login_identifiers SET user_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)',[other.userId,context.source.id]);
    if(kind==='address')await pool.execute('UPDATE login_identifiers SET identifier=? WHERE id=UUID_TO_BIN(?)',[email(),context.source.id]);
    if(kind==='verification')await pool.execute('UPDATE login_identifiers SET verified_at=DATE_ADD(verified_at,INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[context.source.id]);
    if(kind==='recreated'){await pool.execute('DELETE FROM login_identifiers WHERE id=UUID_TO_BIN(?)',[context.source.id]);await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'email',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),s.userId,address]);}
    await reset(raw).expect(401);expect((await tokenRow(raw)).used_at).toBeNull();
  });
  it('a disabled recipient cannot redeem a previously issued link',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);await reset(raw).expect(401);
  });
  it('a credential version change invalidates the token even when its hash is unchanged',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);await reset(raw).expect(401);
  });
  it('a password change during delivery prevents late link issuance',async()=>{
    const s=await account(),address=await alias(s),delivery=app.get(PasswordResetDeliveryService);let release!:()=>void,reached!:()=>void,raw='';
    const gate=new Promise<void>(resolve=>{release=resolve}),observed=new Promise<void>(resolve=>{reached=resolve});
    const spy=vi.spyOn(delivery,'deliver').mockImplementation(async input=>{raw=input.token;reached();await gate;return 'delivered';});
    const pending=service.forgotPassword(address,{ip:'recovery-race'});await observed;await service.changePassword(s.userId,{oldPassword:password,newPassword:changed});release();
    try{expect(await pending).toEqual({requested:true});}finally{spy.mockRestore();}expect(await tokenRow(raw)).toBeUndefined();
  });
  it('a source change during delivery prevents late link issuance',async()=>{
    const s=await account(),address=await alias(s),delivery=app.get(PasswordResetDeliveryService);let release!:()=>void,reached!:()=>void,raw='';
    const gate=new Promise<void>(resolve=>{release=resolve}),observed=new Promise<void>(resolve=>{reached=resolve});
    const spy=vi.spyOn(delivery,'deliver').mockImplementation(async input=>{raw=input.token;reached();await gate;return 'delivered';});
    const pending=service.forgotPassword(address,{ip:'recovery-source-race'});await observed;await pool.execute('UPDATE login_identifiers SET identifier=? WHERE identifier=?',[email(),address]);release();
    try{expect(await pending).toEqual({requested:true});}finally{spy.mockRestore();}expect(await tokenRow(raw)).toBeUndefined();
  });
  it('parallel redemption consumes once and keeps both password stores consistent',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;const results=await Promise.all([reset(raw),reset(raw,changed+'2')]);expect(results.map(r=>r.status).sort()).toEqual([201,401]);
    const after=await state(s.userId);expect(after.modern.password_hash===after.old.password_hash).toBe(true);expect(after.modern.version).toBe(2);await reset(raw).expect(401);
  });
  it('audit failure rolls back both hashes, credential version, link claim and all-session revocation',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!,before=await state(s.userId),audit=app.get(AuditService),append=audit.append.bind(audit);
    const spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='PASSWORD_RESET_COMPLETED')throw new Error('private-recovery-audit-failure');return append(entry,tx);});
    try{const r=await reset(raw).expect(503);expect(JSON.stringify(r.body)).not.toContain('private-recovery-audit-failure');}finally{spy.mockRestore();}
    const after=await state(s.userId);expect(after.modern.password_hash===before.modern.password_hash).toBe(true);expect(after.modern.version).toBe(before.modern.version);expect(after.old.password_hash===before.old.password_hash).toBe(true);
    expect((await tokenRow(raw)).used_at).toBeNull();expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);await reset(raw).expect(201);
  });
  it('issuance audit failure revokes no prior links and issues no partially committed new token',async()=>{
    const s=await account(),address=await alias(s),prior=(await issue(address))!,audit=app.get(AuditService),append=audit.append.bind(audit),before=deliveries.length;
    const spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='PASSWORD_RESET_REQUESTED')throw new Error('private-issuance-audit-failure');return append(entry,tx);});
    try{await post('forgot-password',{email:address}).expect(503);}finally{spy.mockRestore();}
    expect(deliveries.length).toBe(before+1);expect(await tokenRow(deliveries.at(-1)!.token)).toBeUndefined();expect((await tokenRow(prior)).used_at).toBeNull();
  });
  it.each(['unavailable','failed'] as const)('delivery %s issues no new bearer and does not supersede a prior valid link',async status=>{
    const s=await account(),address=await alias(s),prior=(await issue(address))!,spy=vi.spyOn(app.get(PasswordResetDeliveryService),'deliver').mockResolvedValue(status);
    try{expect(await issue(address)).toBeUndefined();}finally{spy.mockRestore();}expect((await tokenRow(prior)).used_at).toBeNull();
  });
  it('limiter failure cannot deliver or issue a usable token',async()=>{
    const before=deliveries.length,spy=vi.spyOn(app.get(RateLimiterService),'consume').mockRejectedValue(new Error('private-limiter-failure'));
    try{const r=await post('forgot-password',{email:email()}).expect(503);expect(JSON.stringify(r.body)).not.toContain('private-limiter-failure');}finally{spy.mockRestore();}expect(deliveries.length).toBe(before);
  });
  it('a reset affects only the original user and keeps other user sessions and credentials',async()=>{
    const a=await account(),b=await account(),address=await alias(a),raw=(await issue(address))!,before=await state(b.userId);await reset(raw).expect(201);
    expect((await service.verifyToken(b.accessToken)).id).toBe(b.userId);expect((await state(b.userId)).modern.password_hash===before.modern.password_hash).toBe(true);
  });
  it('client-selected users, long tokens and bcrypt-overflow passwords are rejected before changing state',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;
    await post('forgot-password',{email:address,userId:randomUUID()}).expect(400);await post('reset-password',{token:raw,newPassword:changed,userId:randomUUID()}).expect(400);
    await post('reset-password',{token:'x'.repeat(1025),newPassword:changed}).expect(400);await reset(raw,'中'.repeat(25)).expect(400);expect((await tokenRow(raw)).used_at).toBeNull();
  });
  it('legacy mode neither advertises nor consumes a bound bearer',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!,spy=vi.spyOn(recovery,'bound').mockReturnValue(false);
    const [oldLookup]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE token_hash=?',[createHash('sha256').update(raw).digest('hex')]);expect(Number(oldLookup[0].n)).toBe(0);
    try{expect(service.loginMethods().passwordRecovery.emailAliases).toBe(false);await reset(raw).expect(401);expect(await issue(address)).toBeUndefined();}finally{spy.mockRestore();}
    expect((await tokenRow(raw)).used_at).toBeNull();await reset(raw).expect(201);
  });
  it('key rotation invalidates recovery tokens and responses expose no secret context',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!,config=(recovery as any).config,get=config.getOrThrow.bind(config);
    const spy=vi.spyOn(config,'getOrThrow').mockImplementation((...args:any[])=>args[0]==='JWT_SECRET'?'rotated-private-fixture-secret-longer-than-32':get(...args));
    try{await reset(raw).expect(401);}finally{spy.mockRestore();}
    const m=await request(app.getHttpServer()).get('/api/auth/methods').expect(200);expect(JSON.stringify(m.body)).not.toMatch(/passwordEpoch|credentialId|sourceLegacyIdentityId|nonce/);
    expect(raw).not.toContain(address);expect(raw).not.toContain(s.userId);expect(raw).not.toContain(password);
  });
  it('suspending requests stops delivery without downgrading validation or reviving old tokens',async()=>{
    const s=await account(),address=await alias(s),bound=(await issue(address))!,legacy=await oldToken(s.userId),spy=vi.spyOn(recovery,'requestsEnabled').mockReturnValue(false);
    try{
      expect(service.loginMethods().passwordRecovery).toEqual({available:false,emailAliases:true});expect(await issue(address)).toBeUndefined();
      await reset(legacy).expect(401);await reset(bound).expect(201);
    }finally{spy.mockRestore();}
  });
  it('a stale but stored bearer has a bounded redemption budget before costly password hashing',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;
    await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    for(let n=0;n<5;n++)await reset(raw).expect(401);await reset(raw).expect(429);
    expect((await tokenRow(raw)).used_at).toBeNull();expect((await service.verifyToken(s.accessToken)).id).toBe(s.userId);
  });
  it('the IP redemption budget rejects malformed bearers without claiming a stored link',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!;
    for(let n=0;n<30;n++)await reset('v2.invalidinvalid.invalidinvalid.invalidinvalid').expect(401);
    await reset(raw).expect(429);expect((await tokenRow(raw)).used_at).toBeNull();
  });
  it('redemption limiter failure cannot update credentials or consume a valid link',async()=>{
    const s=await account(),address=await alias(s),raw=(await issue(address))!,before=await state(s.userId),spy=vi.spyOn(app.get(RateLimiterService),'consume').mockRejectedValue(new Error('private-redeem-limiter-failure'));
    try{await reset(raw).expect(503);}finally{spy.mockRestore();}
    expect((await state(s.userId)).modern.password_hash===before.modern.password_hash).toBe(true);expect((await tokenRow(raw)).used_at).toBeNull();
  });

  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome recovers through a new email, logs into the original account and rejects the used link',async()=>{
    const s=await account(),address=await alias(s);
    const {chromium}=await import('playwright-core'),{createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path');
    const root=path.resolve(process.cwd(),'../..'),dist=path.join(root,'apps/mobile/dist'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
    await app.listen(0,'127.0.0.1');const apiBase=await app.getUrl();const server=createServer((req,res)=>{
      const requested=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url!,'http://localhost').pathname));
      const file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');
      res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));
    });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true});let closing=false;
    try{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);const bridgeFailures:string[]=[];let signedInUser='';
      await page.route('http://127.0.0.1:3001/api/**',async route=>{
        try{const url=new URL(route.request().url()),response=await route.fetch({url:apiBase+url.pathname+url.search,timeout:15000});if(url.pathname==='/api/auth/login'&&response.status()===201)signedInUser=(await response.json()).userId;await route.fulfill({response});}
        catch(error){if(!closing&&!/Route is already handled|Target page, context or browser has been closed/.test(String(error)))bridgeFailures.push('API_BRIDGE_FAILED');}
      });
      const origin='http://127.0.0.1:'+(server.address() as any).port;
      await page.goto(origin+'/auth/forgot-password');await page.getByLabel('恢复邮箱',{exact:true}).fill(address);
      await page.getByText('任一已验证的登录邮箱都可恢复同一账号密码',{exact:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m2-recovery-request.png'),fullPage:true});
      await page.getByRole('button',{name:'申请重置邮件',exact:true}).click();await page.getByText(/请求已提交。若邮箱已验证并配置密码/).waitFor();const raw=deliveries.at(-1)!.token;
      await page.goto(origin+'/auth/reset-password?token='+encodeURIComponent(raw));await page.getByLabel('恢复新密码',{exact:true}).fill(changed);await page.getByLabel('确认恢复密码',{exact:true}).fill(changed);
      await page.screenshot({path:path.join(screenshots,'m2-recovery-reset.png'),fullPage:true});await page.getByRole('button',{name:'重置并重新登录',exact:true}).click();await page.waitForURL('**/auth/password-login');
      await page.getByLabel('邮箱账号',{exact:true}).fill(address);await page.getByLabel('密码',{exact:true}).fill(changed);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/schedule');expect(signedInUser).toBe(s.userId);
      await page.getByRole('button',{name:'我的',exact:true}).first().click();await page.getByRole('button',{name:/账号与登录/}).click();await page.getByText('可用验证码登录，也可恢复当前账号密码',{exact:true}).filter({visible:true}).first().waitFor();
      await page.screenshot({path:path.join(screenshots,'m2-recovery-security.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.getByRole('button',{name:/登录密码/}).filter({visible:true}).first().click();
      await page.getByRole('button',{name:/使用邮箱恢复密码/}).click();await page.waitForURL('**/auth/forgot-password');
      await page.getByLabel('恢复邮箱',{exact:true}).fill(address);await page.getByRole('button',{name:'申请重置邮件',exact:true}).click();await page.getByText(/请求已提交。若邮箱已验证并配置密码/).waitFor();
      await page.screenshot({path:path.join(screenshots,'m2-recovery-signed-in-request.png'),fullPage:true});
      await page.goto(origin+'/auth/reset-password?token='+encodeURIComponent(raw));await page.getByLabel('恢复新密码',{exact:true}).fill(password);await page.getByLabel('确认恢复密码',{exact:true}).fill(password);await page.getByRole('button',{name:'重置并重新登录',exact:true}).click();
      await page.getByText(/恢复链接已失效/).waitFor();await page.getByText('重新申请恢复链接',{exact:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m2-recovery-used-link.png'),fullPage:true});expect(bridgeFailures).toEqual([]);
    }finally{closing=true;for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },90000);
});
