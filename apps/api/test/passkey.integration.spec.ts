import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import IORedis from 'ioredis';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { PasskeyService } from '../src/auth/passkey.service';
import { AuditService } from '../src/audit/audit.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { passkeyUserHandle } from '../src/auth/passkey-proof';
import { CurrentAccountProofService } from '../src/auth/current-account-proof';

const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest();
function authenticator(){
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x!,'base64url')],[-3,Buffer.from(jwk.y!,'base64url')]]));
  return {privateKey,cose,id:randomBytes(32).toString('base64url')};
}
function clientData(type:string,challenge:string,origin:string,extra:Record<string,unknown>={}) {return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false,...extra})).toString('base64url');}
function authData(rp='localhost',flags=5,counter=0){const count=Buffer.alloc(4);count.writeUInt32BE(counter);return Buffer.concat([sha(rp),Buffer.from([flags]),count]);}
function registration(key:ReturnType<typeof authenticator>,options:any,origin:string,flags=0x45,extra:Record<string,unknown>={}){
  const id=Buffer.from(key.id,'base64url'),length=Buffer.alloc(2);length.writeUInt16BE(id.length);
  const data=Buffer.concat([authData('localhost',flags),Buffer.alloc(16),length,id,Buffer.from(key.cose)]);
  return {id:key.id,rawId:key.id,type:'public-key',clientExtensionResults:{credProps:{rk:true}},response:{clientDataJSON:clientData('webauthn.create',options.challenge,origin,extra),attestationObject:Buffer.from(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',data]]))).toString('base64url'),transports:['internal']}};
}
function assertion(key:ReturnType<typeof authenticator>,options:any,origin:string,userId:string,counter=0,flags=5,rp='localhost',extra:Record<string,unknown>={}){
  const client=clientData('webauthn.get',options.challenge,origin,extra),data=authData(rp,flags,counter);
  return {id:key.id,rawId:key.id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client,authenticatorData:data.toString('base64url'),signature:sign('sha256',Buffer.concat([data,sha(Buffer.from(client,'base64url'))]),key.privateKey).toString('base64url'),userHandle:passkeyUserHandle(userId).toString('base64url')}};
}

describe.sequential('Web Passkey real signatures with original SQL accounts and Redis challenges',()=>{
  let app:INestApplication,pool:Pool,service:AuthService,passkeys:PasskeyService,redis:IORedis,prefix:string;
  let origin='http://localhost:4167',webServer:import('node:http').Server|undefined;
  const keys=['AUTH_PASSKEY_ENABLED','AUTH_PASSKEY_RP_ID','AUTH_PASSKEY_ORIGINS','AUTH_PASSWORD_CREDENTIAL_MODE','EMAIL_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),deliveries=new Map<string,string>();
  const password='passkey-account-fixture-secret';
  beforeAll(async()=>{
    if(process.env.AUTH_V2_BROWSER_EXECUTABLE){
      const {createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path'),dist=path.resolve(process.cwd(),'../mobile/dist');
      webServer=createServer((req,res)=>{const requested=path.resolve(dist,'.'+new URL(req.url!,'http://localhost').pathname),file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));});
      await new Promise<void>(resolve=>webServer!.listen(0,'127.0.0.1',resolve));origin='http://localhost:'+(webServer.address() as {port:number}).port;
    }
    process.env.AUTH_PASSKEY_ENABLED='true';process.env.AUTH_PASSKEY_RP_ID='localhost';process.env.AUTH_PASSKEY_ORIGINS=origin;process.env.AUTH_PASSWORD_CREDENTIAL_MODE='UNIFIED';process.env.PUBLIC_REGISTRATION='true';
    process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT='https://passkey-delivery.fixture.test';process.env.LOGIN_CODE_DELIVERY_TOKEN='private-passkey-delivery-fixture-xxxxxxxxxxxxxx';
    prefix=process.env.REDIS_KEY_PREFIX!+':passkey';process.env.REDIS_KEY_PREFIX=process.env.TEST_REDIS_KEY_PREFIX=prefix;
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{if(String(url)!==process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT)throw new Error('Unexpected outbound request');const body=JSON.parse(String(options.body));deliveries.set(body.purpose+':'+body.recipient,body.code);return {ok:true};}));
    ({app,pool}=await bootP2App('passkey'));service=app.get(AuthService);passkeys=app.get(PasskeyService);redis=new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async()=>{const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);});
  afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();await new Promise<void>(resolve=>webServer?webServer.close(()=>resolve()):resolve());for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const post=(path:string,body:unknown,token?:string)=>{const test=request(app.getHttpServer()).post('/api/auth/passkeys/'+path);if(token)test.set(auth(token));return test.send(body);};
  async function account(){const email='passkey-'+randomUUID()+'@example.test';return {...await service.register({email,password,displayName:'Passkey fixture'}),email};}
  async function options(s:{accessToken:string},label='我的设备'){
    const start=await post('start',{operation:'register',proof:'password',password,label},s.accessToken).expect(201);
    return (await post('register/options',{challenge:start.body.challenge},s.accessToken).expect(201)).body;
  }
  async function enroll(s:Awaited<ReturnType<typeof account>>,flags=0x45){const key=authenticator(),g=await options(s);const result=await post('register/verify',{challenge:g.challenge,credential:registration(key,g.options,origin,flags)},s.accessToken).expect(201);return {key,id:result.body.id as string};}
  async function loginGrant(){return (await post('login/options',{}).expect(201)).body;}
  async function count(table:string,userId:string){return Number((await pool.execute<RowDataPacket[]>('SELECT COUNT(*) n FROM '+table+' WHERE user_id=UUID_TO_BIN(?)',[userId]))[0][0].n);}

  it('registers to original UID, preserves profile/membership and issues refreshable/revocable original sessions',async()=>{
    const s=await account(),[before]=await pool.execute('SELECT * FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]),c=await enroll(s),g=await loginGrant();
    expect(g.options.allowCredentials??[]).toEqual([]);expect(g.options.userVerification).toBe('required');
    const result=await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(201);
    expect(result.body.userId).toBe(s.userId);expect(await count('passkey_credentials',s.userId)).toBe(1);expect(await count('user_memberships',s.userId)).toBe(1);
    expect((await pool.execute('SELECT * FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]))[0]).toEqual(before);
    const user=await service.verifyToken(result.body.accessToken);expect(user.id).toBe(s.userId);
    const refreshed=await service.refresh(result.body.refreshToken,{});expect(refreshed.userId).toBe(s.userId);await service.logout(refreshed.refreshToken);await expect(service.verifyToken(refreshed.accessToken)).rejects.toThrow();
    const m=(await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(200)).body;
    expect(m.passkeys.credentials).toEqual([expect.objectContaining({id:c.id,label:'我的设备'})]);expect(JSON.stringify(m.passkeys)).not.toMatch(/publicKey|credentialId|userHandle/);
  });
  it('email OTP proves current password-free account and cannot be used as a login code',async()=>{
    const email='passkey-otp-'+randomUUID()+'@example.test',s=await service.loginVerified('email',email,{}),m=await passkeys.capabilities(await service.verifyToken(s.accessToken));
    const start=await post('start',{operation:'register',proof:'code',identifierId:m.passkeys!.sources[0].id,label:'邮箱账号设备'},s.accessToken).expect(201),challenge=start.body.challenge,code=deliveries.get('passkey-register-current:'+email)!;
    await post('register/options',{challenge},s.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:email,code}).expect(401);
    await post('current/confirm',{challenge,code},s.accessToken).expect(201);
    const g=(await post('register/options',{challenge},s.accessToken).expect(201)).body,key=authenticator();
    await post('register/verify',{challenge,credential:registration(key,g.options,origin)},s.accessToken).expect(201);
    expect((await service.securityMethods(s.userId)).passwordConfigured).toBe(false);
    const login=await loginGrant();expect((await post('login/verify',{challenge:login.challenge,credential:assertion(key,login.options,origin,s.userId)}).expect(201)).body.userId).toBe(s.userId);
  });
  it('requires fresh account proof, strict DTOs and server-owned user/session',async()=>{
    const s=await account(),other=await account();
    await post('login/options',{userId:other.userId}).expect(400);
    await post('start',{operation:'register',proof:'password',password:'incorrect',label:'设备'},s.accessToken).expect(401);
    await post('start',{operation:'register',proof:'password',password,label:'设备',identifierId:randomUUID()},s.accessToken).expect(400);
    await post('start',{operation:'register',proof:'password',password,label:'设备',userId:other.userId},s.accessToken).expect(400);
    const g=await options(s),key=authenticator(),body={challenge:g.challenge,credential:registration(key,g.options,origin)};
    await post('register/verify',body,other.accessToken).expect(401);
    const second=await service.login({email:s.email,password},{});await post('register/verify',body,second.accessToken).expect(401);
    await post('register/verify',{...body,sessionId:randomUUID()},s.accessToken).expect(400);
    await post('register/verify',body,s.accessToken).expect(201);
  });
  it.each(['refresh','password-version','logout','disable','source-disabled'] as const)('%s invalidates pending registration',async action=>{
    const s=await account();let g:any;
    if(action==='source-disabled'){
      const otp=await service.loginVerified('email','source-'+randomUUID()+'@example.test',{}),m=await passkeys.capabilities(await service.verifyToken(otp.accessToken));
      const start=await post('start',{operation:'register',proof:'code',identifierId:m.passkeys!.sources[0].id,label:'设备'},otp.accessToken).expect(201);
      await pool.execute('UPDATE login_identifiers SET disabled_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)',[m.passkeys!.sources[0].id]);
      await post('current/confirm',{challenge:start.body.challenge,code:deliveries.get('passkey-register-current:'+((await pool.execute<RowDataPacket[]>('SELECT identifier FROM login_identifiers WHERE id=UUID_TO_BIN(?)',[m.passkeys!.sources[0].id]))[0][0].identifier))},otp.accessToken).expect(401);return;
    }
    g=await options(s);
    if(action==='refresh'){const refreshed=await service.refresh(s.refreshToken,{});s.accessToken=refreshed.accessToken;}
    if(action==='password-version')await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    if(action==='logout')await service.logout(s.refreshToken);
    if(action==='disable')await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
    await post('register/verify',{challenge:g.challenge,credential:registration(authenticator(),g.options,origin)},s.accessToken).expect(401);
    expect(await count('passkey_credentials',s.userId)).toBe(0);
  });
  it.each(['origin','challenge','type','rp','uv','cross-origin'] as const)('registration rejects invalid %s with no stored key and consumes attempted challenge',async field=>{
    const s=await account(),g=await options(s),key=authenticator();let credential=registration(key,g.options,field==='origin'?'https://attacker.test':origin,field==='uv'?0x41:0x45,field==='cross-origin'?{crossOrigin:true}:{});
    if(field==='challenge')credential=registration(key,{...g.options,challenge:randomBytes(32).toString('base64url')},origin);
    if(field==='type')credential.response.clientDataJSON=clientData('webauthn.get',g.options.challenge,origin);
    if(field==='rp'){const obj=isoCBOR.decodeFirst<Map<string,any>>(Buffer.from(credential.response.attestationObject,'base64url'));const data=Buffer.from(obj.get('authData'));sha('attacker.test').copy(data,0);obj.set('authData',data);credential.response.attestationObject=Buffer.from(isoCBOR.encode(obj)).toString('base64url');}
    await post('register/verify',{challenge:g.challenge,credential},s.accessToken).expect(401);
    await post('register/verify',{challenge:g.challenge,credential:registration(key,g.options,origin)},s.accessToken).expect(401);expect(await count('passkey_credentials',s.userId)).toBe(0);
  });
  it.each(['origin','challenge','type','rp','uv','signature','user-handle','cross-origin','raw-id'] as const)('login rejects invalid %s and creates no session',async field=>{
    const s=await account(),c=await enroll(s),g=await loginGrant();let credential=assertion(c.key,field==='challenge'?{...g.options,challenge:randomBytes(32).toString('base64url')}:g.options,field==='origin'?'https://attacker.test':origin,s.userId,0,field==='uv'?1:5,field==='rp'?'attacker.test':'localhost',field==='cross-origin'?{crossOrigin:true}:{});
    if(field==='type')credential.response.clientDataJSON=clientData('webauthn.create',g.options.challenge,origin);
    if(field==='signature')credential.response.signature=randomBytes(70).toString('base64url');
    if(field==='user-handle')credential.response.userHandle=passkeyUserHandle(randomUUID()).toString('base64url');
    if(field==='raw-id')credential.rawId=randomBytes(32).toString('base64url');
    const before=await count('auth_sessions',s.userId);await post('login/verify',{challenge:g.challenge,credential}).expect(401);expect(await count('auth_sessions',s.userId)).toBe(before);
    await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(401);
  });
  it('rejects unknown/revoked keys uniformly without creating any account',async()=>{
    const s=await account(),c=await enroll(s),g=await loginGrant(),unknown=authenticator();
    await post('login/verify',{challenge:g.challenge,credential:assertion(unknown,g.options,origin,s.userId)}).expect(401);
    await pool.execute('UPDATE passkey_credentials SET revoked_at=UTC_TIMESTAMP(6),version=version+1 WHERE id=UUID_TO_BIN(?)',[c.id]);
    const next=await loginGrant();await post('login/verify',{challenge:next.challenge,credential:assertion(c.key,next.options,origin,s.userId)}).expect(401);expect(await count('auth_sessions',s.userId)).toBe(1);
  });
  it('handles synchronized backed-up credentials and legal zero counters, rejects counter rollback',async()=>{
    const s=await account(),c=await enroll(s,0x5d);
    for(let i=0;i<2;i++){const g=await loginGrant();await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId,0,0x1d)}).expect(201);}
    const [rows]=await pool.execute<RowDataPacket[]>('SELECT sign_count,backed_up,device_type,version FROM passkey_credentials WHERE id=UUID_TO_BIN(?)',[c.id]);expect(rows[0]).toMatchObject({sign_count:0,backed_up:1,device_type:'multiDevice',version:3});
    const g=await loginGrant();await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId,5,0x1d)}).expect(201);
    const stale=await loginGrant();await post('login/verify',{challenge:stale.challenge,credential:assertion(c.key,stale.options,origin,s.userId,4,0x1d)}).expect(401);
  });
  it('single challenge concurrent replay creates exactly one session and one login audit',async()=>{
    const s=await account(),c=await enroll(s),g=await loginGrant(),body={challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)};
    const results=await Promise.all([post('login/verify',body),post('login/verify',body)]);expect(results.map(r=>r.status).sort()).toEqual([201,401]);expect(await count('auth_sessions',s.userId)).toBe(2);
    const [rows]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='PASSKEY_LOGIN_SUCCESS'",[s.userId]);expect(Number(rows[0].n)).toBe(1);
  });
  it('register/login purpose isolation, expiry and nested payload limits fail closed',async()=>{
    const s=await account(),g=await options(s),key=authenticator();await post('login/verify',{challenge:g.challenge,credential:assertion(key,g.options,origin,s.userId)}).expect(401);
    await post('register/verify',{challenge:g.challenge,credential:{...registration(key,g.options,origin),userId:s.userId}},s.accessToken).expect(400);
    await post('register/verify',{challenge:g.challenge,credential:{...registration(key,g.options,origin),response:{...registration(key,g.options,origin).response,clientDataJSON:'a'.repeat(5000)}}},s.accessToken).expect(400);
    const redisKey=(passkeys as any).key(g.challenge),state=JSON.parse((await redis.get(redisKey))!);state.expiresAt=Date.now()-1;await redis.set(redisKey,JSON.stringify(state),'EX',60);
    await post('register/verify',{challenge:g.challenge,credential:registration(key,g.options,origin)},s.accessToken).expect(401);
  });
  it.each(['revoked','owner','public-key','version','disabled-user','expired-challenge'] as const)('transaction recheck blocks %s after successful signature validation',async change=>{
    const s=await account(),other=await account(),c=await enroll(s),g=await loginGrant(),original=service.loginPasskey.bind(service);
    const spy=vi.spyOn(service,'loginPasskey').mockImplementationOnce(async(proof,context)=>{
      if(change==='revoked')await pool.execute('UPDATE passkey_credentials SET revoked_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)',[c.id]);
      if(change==='owner')await pool.execute('UPDATE passkey_credentials SET user_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)',[other.userId,c.id]);
      if(change==='public-key')await pool.execute("UPDATE passkey_credentials SET public_key='invalid' WHERE id=UUID_TO_BIN(?)",[c.id]);
      if(change==='version')await pool.execute('UPDATE passkey_credentials SET version=version+1 WHERE id=UUID_TO_BIN(?)',[c.id]);
      if(change==='disabled-user')await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
      if(change==='expired-challenge')proof={...proof,expiresAt:Date.now()-1};
      return original(proof,context);
    });
    try{await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(401);expect(await count('auth_sessions',s.userId)).toBe(1);}finally{spy.mockRestore();}
  });
  it('audit failure rolls back registration and login counter/session, without resurrecting challenge',async()=>{
    const s=await account(),g=await options(s),key=authenticator(),audit=app.get(AuditService),original=audit.append.bind(audit);
    const spy=vi.spyOn(audit,'append').mockImplementation(async(input,tx)=>{if(input.action==='PASSKEY_REGISTERED')throw new Error('private audit failure');return original(input,tx);});
    try{const result=await post('register/verify',{challenge:g.challenge,credential:registration(key,g.options,origin)},s.accessToken).expect(503);expect(JSON.stringify(result.body)).not.toContain('private');expect(await count('passkey_credentials',s.userId)).toBe(0);}finally{spy.mockRestore();}
    await post('register/verify',{challenge:g.challenge,credential:registration(key,g.options,origin)},s.accessToken).expect(401);
    const c=await enroll(s),login=await loginGrant(),spy2=vi.spyOn(audit,'append').mockImplementation(async(input,tx)=>{if(input.action==='PASSKEY_LOGIN_SUCCESS')throw new Error('private login audit failure');return original(input,tx);});
    try{await post('login/verify',{challenge:login.challenge,credential:assertion(c.key,login.options,origin,s.userId,1)}).expect(503);expect(await count('auth_sessions',s.userId)).toBe(1);expect((await pool.execute<RowDataPacket[]>('SELECT sign_count FROM passkey_credentials WHERE id=UUID_TO_BIN(?)',[c.id]))[0][0].sign_count).toBe(0);}finally{spy2.mockRestore();}
  });
  it('revoke requires fresh proof, belongs to original user and revokes every session',async()=>{
    const s=await account(),c=await enroll(s),other=await account();
    await post('start',{operation:'revoke',proof:'password',password,credentialId:c.id},other.accessToken).expect(401);
    const g=await loginGrant(),logged=(await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(201)).body;
    const proof=(await post('start',{operation:'revoke',proof:'password',password,credentialId:c.id},s.accessToken).expect(201)).body;
    await post('register/options',{challenge:proof.challenge},s.accessToken).expect(401);
    await post('revoke/confirm',{challenge:proof.challenge},s.accessToken).expect(201);
    await expect(service.verifyToken(s.accessToken)).rejects.toThrow();await expect(service.verifyToken(logged.accessToken)).rejects.toThrow();await expect(service.refresh(logged.refreshToken,{})).rejects.toThrow();
    const fresh=await service.login({email:s.email,password},{});expect(fresh.userId).toBe(s.userId);
    const next=await loginGrant();await post('login/verify',{challenge:next.challenge,credential:assertion(c.key,next.options,origin,s.userId)}).expect(401);
  });
  it('Redis challenge loss fails closed and later recovery does not issue delayed sessions',async()=>{
    const s=await account(),c=await enroll(s),g=await loginGrant();await redis.del((passkeys as any).key(g.challenge));
    await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(401);expect(await count('auth_sessions',s.userId)).toBe(1);
  });
  it('manages multiple keys without reusing a revoked or already-owned credential ID',async()=>{
    const s=await account(),first=await enroll(s),second=await enroll(s),g=await options(s);
    await post('register/verify',{challenge:g.challenge,credential:registration(first.key,g.options,origin)},s.accessToken).expect(401);
    expect(await count('passkey_credentials',s.userId)).toBe(2);
    const proof=(await post('start',{operation:'revoke',proof:'password',password,credentialId:first.id},s.accessToken).expect(201)).body;
    await post('revoke/confirm',{challenge:proof.challenge},s.accessToken).expect(201);
    const next=await loginGrant();expect((await post('login/verify',{challenge:next.challenge,credential:assertion(second.key,next.options,origin,s.userId)}).expect(201)).body.userId).toBe(s.userId);
    const fresh=await service.login({email:s.email,password},{}),other=await account(),attempt=await options(other);
    await post('register/verify',{challenge:attempt.challenge,credential:registration(first.key,attempt.options,origin)},other.accessToken).expect(401);
    expect(fresh.userId).toBe(s.userId);
  });
  it('enforces a bounded active credential count',async()=>{
    const s=await account();for(let i=0;i<10;i++)await enroll(s);
    const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
    await post('start',{operation:'register',proof:'password',password,label:'第十一把'},s.accessToken).expect(409);expect(await count('passkey_credentials',s.userId)).toBe(10);
  });
  it('last key cannot be removed after all usable login aliases disappear',async()=>{
    const s=await account(),c=await enroll(s),otherEmail='conflict-'+randomUUID()+'@example.test';await service.loginVerified('email',otherEmail,{});
    const proof=(await post('start',{operation:'revoke',proof:'password',password,credentialId:c.id},s.accessToken).expect(201)).body;
    // Simulate a recovery-channel loss without changing the frozen password credential.
    await pool.execute('UPDATE auth_identities SET email=? WHERE user_id=UUID_TO_BIN(?)',[otherEmail,s.userId]);
    await post('revoke/confirm',{challenge:proof.challenge},s.accessToken).expect(409);expect((await pool.execute<RowDataPacket[]>('SELECT revoked_at FROM passkey_credentials WHERE id=UUID_TO_BIN(?)',[c.id]))[0][0].revoked_at).toBeNull();
    await service.verifyToken(s.accessToken);
  });
  it('Redis service failure rejects within its request deadline and exposes no private error',async()=>{
    const s=await account(),c=await enroll(s),g=await loginGrant(),client=(passkeys as any).redis as IORedis;
    const spy=vi.spyOn(client,'get').mockRejectedValueOnce(new Error('private Redis connection'));
    const started=performance.now();try{const response=await post('login/verify',{challenge:g.challenge,credential:assertion(c.key,g.options,origin,s.userId)}).expect(503);expect(response.body.code).toBe('PASSKEY_SERVICE_UNAVAILABLE');expect(JSON.stringify(response.body)).not.toContain('private');expect(performance.now()-started).toBeLessThan(5000);}finally{spy.mockRestore();}
    expect(await count('auth_sessions',s.userId)).toBe(1);
  });
  it('a registration proof expiring during a real SQL row-lock wait cannot write a key',async()=>{
    const s=await account(),g=await options(s),credential=registration(authenticator(),g.options,origin),key=(passkeys as any).key(g.challenge),state=JSON.parse((await redis.get(key))!);
    const locker=await pool.getConnection(),current=app.get(CurrentAccountProofService),original=current.assertSession.bind(current);let release!:()=>void;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const reached=new Promise<void>((resolve,reject)=>{release=()=>{clearTimeout(timer);resolve();};timer=setTimeout(()=>reject(new Error('Fixture did not reach SQL transaction')),5000);});
    const spy=vi.spyOn(current,'assertSession').mockImplementation(async(user,reader,lock)=>{if(lock)release();return original(user,reader,lock);});
    try{
      await locker.beginTransaction();await locker.execute('SELECT id FROM users WHERE id=UUID_TO_BIN(?) FOR UPDATE',[s.userId]);
      state.expiresAt=Date.now()+1000;await redis.set(key,JSON.stringify(state),'EX',60);
      const pending=post('register/verify',{challenge:g.challenge,credential},s.accessToken).then(response=>response);
      await reached;await new Promise(resolve=>setTimeout(resolve,1100));await locker.rollback();
      expect((await pending).status).toBe(401);expect(await count('passkey_credentials',s.userId)).toBe(0);expect(await redis.get(key)).toBeNull();
    }finally{clearTimeout(timer);spy.mockRestore();await locker.rollback();locker.release();}
  });
  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('Chrome virtual authenticator registers/logs in/removes using real UI and real signature verification',async()=>{
    await app.listen(0,'127.0.0.1');const base=await app.getUrl(),{chromium}=await import('playwright-core');
    const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(20000);
    const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    const email='passkey-browser-'+randomUUID()+'@example.test',s=await service.loginVerified('email',email,{});let originalUser='',loggedUser='';
    await page.route('http://127.0.0.1:3001/api/**',async route=>{try{const url=new URL(route.request().url()),response=await route.fetch({url:base+url.pathname+url.search,timeout:20000});if(url.pathname==='/api/auth/code/verify'&&response.status()===201)originalUser=(await response.json()).userId;if(url.pathname==='/api/auth/passkeys/login/verify'&&response.status()===201)loggedUser=(await response.json()).userId;await route.fulfill({response});}catch(error){if(!/already handled|closed/.test(String(error)))throw error;}});
    try{
      await page.goto(origin+'/auth/login');await page.getByRole('textbox',{name:'邮箱',exact:true}).fill(email);await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).filter({visible:true}).waitFor();
      await page.getByRole('textbox',{name:'验证码',exact:true}).fill(deliveries.get('login:'+email)!);await page.getByRole('button',{name:'验证并登录',exact:true}).click();await page.waitForURL('**/schedule');expect(originalUser).toBe(s.userId);
      // Avoid a one-minute real wait between distinct UI proofs in this isolated fixture.
      {const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);}
      await page.getByRole('button',{name:'我的',exact:true}).first().click();await page.getByRole('button',{name:/账号与登录/}).click();await page.getByRole('button',{name:/通行密钥/}).click();
      await page.getByRole('textbox',{name:'通行密钥名称',exact:true}).fill('Chrome 验证设备');await page.getByRole('button',{name:'验证账号并添加通行密钥',exact:true}).click();
      await page.getByRole('textbox',{name:'当前账号验证码',exact:true}).waitFor();await page.getByRole('textbox',{name:'当前账号验证码',exact:true}).fill(deliveries.get('passkey-register-current:'+email)!);await page.getByRole('button',{name:'验证当前账号',exact:true}).click();
      await page.getByRole('button',{name:'在设备上创建通行密钥',exact:true}).click();await page.getByText('通行密钥已添加，仍然登录原来的账号。',{exact:true}).filter({visible:true}).waitFor();
      const path=await import('node:path'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;await page.screenshot({path:path.join(screenshots,'m4-passkey-registered.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.goto(origin+'/auth/login');await page.getByRole('button',{name:'使用通行密钥登录',exact:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m4-passkey-login.png'),fullPage:true});await page.getByRole('button',{name:'使用通行密钥登录',exact:true}).click();await page.waitForURL('**/schedule');expect(loggedUser).toBe(s.userId);
      {const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);}
      await page.getByRole('button',{name:'我的',exact:true}).first().click();await page.getByRole('button',{name:/账号与登录/}).click();await page.getByRole('button',{name:/通行密钥/}).click();
      await page.getByRole('button',{name:'移除 Chrome 验证设备',exact:true}).click();await page.getByRole('textbox',{name:'当前账号验证码',exact:true}).waitFor();await page.getByRole('textbox',{name:'当前账号验证码',exact:true}).fill(deliveries.get('passkey-revoke-current:'+email)!);await page.getByRole('button',{name:'验证当前账号',exact:true}).click();await page.getByRole('button',{name:'确认移除并退出所有设备',exact:true}).click();await page.waitForURL('**/auth/login?reason=passkey-revoked');
      await page.getByText('通行密钥已移除，所有设备已退出。请使用已绑定的其他方式登录原账号。',{exact:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m4-passkey-revoked.png'),fullPage:true});
      const [rows]=await pool.execute<RowDataPacket[]>('SELECT revoked_at FROM passkey_credentials WHERE user_id=UUID_TO_BIN(?)',[s.userId]);expect(rows).toHaveLength(1);expect(rows[0].revoked_at).not.toBeNull();await expect(service.verifyToken(s.accessToken)).rejects.toThrow();
    }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
  },90000);
});
