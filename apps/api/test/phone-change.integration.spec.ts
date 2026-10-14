import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { IdentityResolverService } from '../src/auth/identity-resolver.service';
import { PhoneChangeService } from '../src/auth/phone-change.service';
import { PhoneBindingService } from '../src/auth/phone-binding.service';
import { SecurityNoticeService } from '../src/auth/security-notice.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { AuditService } from '../src/audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { maskIdentifier } from '../src/auth/login-identifier';
import { SmsCodeDeliveryService } from '../src/auth/sms-code-delivery.service';

describe.sequential('M3-03 phone replacement and durable security notices', () => {
  let app: INestApplication, pool: Pool, service: AuthService, change: PhoneChangeService, notices: SecurityNoticeService, codes: LoginCodeService, redis: IORedis, prefix: string;
  const keys = ['AUTH_PHONE_CHANGE_ENABLED','AUTH_SECURITY_NOTICE_SEND_ENABLED','AUTH_SECURITY_NOTICE_ENDPOINT','AUTH_SECURITY_NOTICE_TOKEN','AUTH_SECURITY_NOTICE_PHONE_TEMPLATE','AUTH_SECURITY_NOTICE_EMAIL_TEMPLATE','SMS_LOGIN_SEND_ENABLED','SMS_LOGIN_TEMPLATE_ID','SMS_LOGIN_QUOTA_SECRET','AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_PHONE_BIND_ENABLED','EMAIL_LOGIN_DELIVERY_ENDPOINT','SMS_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  const deliveries = new Map<string,string>(), outbound: Array<Record<string,any>> = [];
  const password = 'correct-horse-battery-staple';
  const phone = () => '+86139' + String(Math.floor(Math.random()*100000000)).padStart(8,'0');
  const email = () => 'phone-change-'+randomUUID()+'@example.test';
  let clock: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    Object.assign(process.env,{AUTH_PASSWORD_CREDENTIAL_MODE:'UNIFIED',AUTH_PHONE_CHANGE_ENABLED:'true',AUTH_PHONE_BIND_ENABLED:'true',AUTH_SECURITY_NOTICE_SEND_ENABLED:'true',AUTH_SECURITY_NOTICE_ENDPOINT:'https://security-notice.fixture.test',AUTH_SECURITY_NOTICE_TOKEN:'private-security-notice-fixture-token-xxxxxxxx',AUTH_SECURITY_NOTICE_PHONE_TEMPLATE:'fixture-security-phone',AUTH_SECURITY_NOTICE_EMAIL_TEMPLATE:'fixture-security-email',SMS_LOGIN_SEND_ENABLED:'true',SMS_LOGIN_TEMPLATE_ID:'fixture-login',SMS_LOGIN_QUOTA_SECRET:'private-stable-quota-fixture-xxxxxxxxxxxxxxxxxx',EMAIL_LOGIN_DELIVERY_ENDPOINT:'https://code.fixture.test',SMS_LOGIN_DELIVERY_ENDPOINT:'https://code.fixture.test',LOGIN_CODE_DELIVERY_TOKEN:'private-code-fixture-token-xxxxxxxxxxxxxxxxxxxx',PUBLIC_REGISTRATION:'true'});
    prefix = process.env.REDIS_KEY_PREFIX! + ':phone-change'; process.env.REDIS_KEY_PREFIX = process.env.TEST_REDIS_KEY_PREFIX = prefix;
    vi.stubGlobal('fetch',vi.fn(async (url:string,options:RequestInit) => {
      if (![process.env.AUTH_SECURITY_NOTICE_ENDPOINT,process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT].includes(String(url))) throw new Error('Unexpected outbound request');
      expect(options.redirect).toBe('error'); const body=JSON.parse(String(options.body));
      outbound.push(body); if(body.code) deliveries.set(body.purpose+':'+body.recipient,body.code);
      return {ok:true,json:async()=>({accepted:true,requestId:body.requestId,providerRequestId:'fixture-notice',costFen:3})};
    }));
    ({app,pool}=await bootP2App('phone-change'));
    service=app.get(AuthService);change=app.get(PhoneChangeService);notices=app.get(SecurityNoticeService);codes=app.get(LoginCodeService);redis=new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async () => {
    clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()); deliveries.clear();outbound.length=0;
    await pool.execute('DELETE FROM auth_sms_attempts WHERE quota_namespace=?',[prefix]);await pool.execute('DELETE FROM auth_sms_quotas WHERE quota_namespace=?',[prefix]);
    // Preserve previous jobs for backup/restore; only current fixture jobs are due.
    await pool.execute("UPDATE auth_security_notices SET next_attempt_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 100 YEAR) WHERE state='PENDING'");
    const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
  });
  afterEach(()=>clock.mockRestore());
  afterAll(async () => {vi.restoreAllMocks();vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const post=(token:string,path:string,body:unknown)=>request(app.getHttpServer()).post('/api/auth/phone-change/'+path).set(auth(token)).send(body);
  const methods=async(token:string)=>(await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(token)).expect(200)).body;
  async function account(withPassword=true) {
    const address=email(), oldPhone=phone(),oldIdentifierId=randomUUID();
    const session=withPassword?await service.register({email:address,password,displayName:'Phone change fixture'}):await service.loginVerified('email',address,{});
    await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'phone',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[oldIdentifierId,session.userId,oldPhone]);
    return {...session,email:address,oldPhone,oldIdentifierId};
  }
  async function start(s:Awaited<ReturnType<typeof account>>,target=phone()) {
    const result=await post(s.accessToken,'start',{phone:target,oldIdentifierId:s.oldIdentifierId,proof:'password',password}).expect(201);
    return {challenge:result.body.challenge as string,target};
  }
  async function targetCode(s:{accessToken:string},g:{challenge:string;target:string}) {await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(201);return deliveries.get('phone-change-target:'+g.target)!;}
  async function rows(s:{userId:string}) {return (await pool.execute<RowDataPacket[]>('SELECT identifier,disabled_at FROM login_identifiers WHERE user_id=UUID_TO_BIN(?) ORDER BY identifier',[s.userId]))[0];}
  async function jobs(s:{userId:string}) {return (await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id,channel,state,attempts,recipient_cipher,masked FROM auth_security_notices WHERE user_id=UUID_TO_BIN(?) ORDER BY channel',[s.userId]))[0];}
  async function finish(s:Awaited<ReturnType<typeof account>>) {const g=await start(s),code=await targetCode(s,g);await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);return g;}

  it('changes only credentials, revokes every session/recovery token and preserves the original profile/UID',async()=>{
    const s=await account(),second=await service.login({email:s.email,password},{}),g=await start(s),code=await targetCode(s,g);
    const [before]=await pool.execute<RowDataPacket[]>('SELECT * FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await pool.execute("INSERT INTO password_reset_tokens(id,user_id,token_hash,created_at,expires_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR))",[randomUUID(),s.userId,randomUUID().replaceAll('-','').padEnd(64,'0')]);
    const response=await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);expect(response.body).toEqual({changed:true,reauthenticate:true,notification:'QUEUED'});
    const mappings=await rows(s);expect(mappings.find(row=>row.identifier===s.oldPhone)?.disabled_at).toBeInstanceOf(Date);expect(mappings.find(row=>row.identifier===g.target)?.disabled_at).toBeNull();
    for(const token of [s.accessToken,second.accessToken])await expect(service.verifyToken(token)).rejects.toMatchObject({status:401});
    for(const refresh of [s.refreshToken,second.refreshToken])await expect(service.refresh(refresh,{})).rejects.toMatchObject({status:401});
    const [resets]=await pool.execute<RowDataPacket[]>('SELECT used_at FROM password_reset_tokens WHERE user_id=UUID_TO_BIN(?)',[s.userId]);expect(resets.every(row=>row.used_at)).toBe(true);
    expect((await service.loginVerified('phone',g.target,{})).userId).toBe(s.userId);expect((await service.login({kind:'phone',identifier:g.target,password},{})).userId).toBe(s.userId);
    await expect(service.loginVerified('phone',s.oldPhone,{})).rejects.toMatchObject({response:{code:'LOGIN_IDENTIFIER_DISABLED'}});
    await expect(service.login({kind:'phone',identifier:s.oldPhone,password},{})).rejects.toMatchObject({status:401});
    const [after]=await pool.execute<RowDataPacket[]>('SELECT * FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]);expect(after).toEqual(before);
    const pending=await jobs(s);expect(pending).toHaveLength(1);expect(pending[0]).toMatchObject({state:'PENDING',attempts:0});expect(pending[0].recipient_cipher).not.toContain(s.oldPhone);
  });
  it.each(['email','phone'] as const)('password-free users can prove their existing %s and new phone',async kind=>{
    const s=await account(false),m=await methods(s.accessToken),source=m.phoneChange.sources.find((item:any)=>item.kind===kind),target=phone();
    const r=await post(s.accessToken,'start',{phone:target,oldIdentifierId:s.oldIdentifierId,proof:'code',identifierId:source.id}).expect(201),challenge=r.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('phone-change-current:'+(kind==='email'?s.email:s.oldPhone))}).expect(201);
    const code=await targetCode(s,{challenge,target});await post(s.accessToken,'confirm',{challenge,code}).expect(201);
    const session=await service.loginVerified('phone',target,{});expect(session.userId).toBe(s.userId);expect((await methods(session.accessToken)).passwordConfigured).toBe(false);
    expect(await jobs(s)).toHaveLength(2);
  });
  it('requires current proof, freezes the old identifier/target and rejects foreign or unchanged old numbers',async()=>{
    const s=await account(),other=await account();
    for(const body of [{phone:phone(),proof:'password',password},{phone:phone(),oldIdentifierId:other.oldIdentifierId,proof:'password',password},{phone:s.oldPhone,oldIdentifierId:s.oldIdentifierId,proof:'password',password}])expect([400,401]).toContain((await post(s.accessToken,'start',body)).status);
    await post(s.accessToken,'start',{phone:phone(),oldIdentifierId:s.oldIdentifierId,proof:'password',password:'wrong'}).expect(401);
    const g=await start(s);await post(s.accessToken,'target/request',{challenge:g.challenge,oldIdentifierId:other.oldIdentifierId}).expect(400);await post(s.accessToken,'target/request',{challenge:g.challenge,phone:phone()}).expect(400);
    expect(outbound).toHaveLength(0);
  });
  it('rejects another UID/sid without consuming the original grant',async()=>{
    const s=await account(),other=await account(),second=await service.login({email:s.email,password},{}),g=await start(s);
    await post(other.accessToken,'target/request',{challenge:g.challenge}).expect(401);await post(second.accessToken,'target/request',{challenge:g.challenge}).expect(401);
    const code=await targetCode(s,g);await post(second.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
  });
  it.each(['refresh','logout','password-version','old-version','expired','disabled'] as const)('%s invalidates an outstanding phone-change grant',async action=>{
    const s=await account(),g=await start(s),user=await service.verifyToken(s.accessToken);let current=user;
    if(action==='refresh')current=await service.verifyToken((await service.refresh(s.refreshToken,{})).accessToken);
    if(action==='logout')await service.logout(s.refreshToken);
    if(action==='password-version')await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    if(action==='old-version')await pool.execute('UPDATE login_identifiers SET verified_at=DATE_ADD(verified_at,INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[s.oldIdentifierId]);
    if(action==='expired')clock.mockReturnValue(Date.now()+600001);
    if(action==='disabled')await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
    await expect(change.requestTarget(current,g.challenge,'fixture')).rejects.toMatchObject({response:{code:'PHONE_CHANGE_PROOF_EXPIRED'}});expect(await jobs(s)).toHaveLength(0);
  });
  it('a target occupied before or after starting cannot be transferred',async()=>{
    const s=await account(),other=await account();await post(s.accessToken,'start',{phone:other.oldPhone,oldIdentifierId:s.oldIdentifierId,proof:'password',password}).expect(409);
    const g=await start(s),code=await targetCode(s,g),owner=await service.loginVerified('phone',g.target,{});
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(409);expect(owner.userId).not.toBe(s.userId);expect((await rows(s)).find(row=>row.identifier===s.oldPhone)?.disabled_at).toBeNull();
  });
  it('binding/login OTPs and binding challenges cannot authorize replacement',async()=>{
    const s=await account(),g=await start(s),user=await service.verifyToken(s.accessToken);
    await codes.request({kind:'phone',identifier:g.target},'scope-fixture');await post(s.accessToken,'confirm',{challenge:g.challenge,code:deliveries.get('login:'+g.target)}).expect(401);
    const bound=await app.get(PhoneBindingService).start(user,{phone:phone(),proof:'password',password},'scope-fixture');await post(s.accessToken,'target/request',{challenge:bound.challenge}).expect(401);
  });
  it.each(['audit','notice'] as const)('%s failure rolls back replacement, revocation and notifications; spent proofs cannot be replayed',async failure=>{
    const s=await account(),g=await start(s),code=await targetCode(s,g);let spy:ReturnType<typeof vi.spyOn>;
    if(failure==='audit'){const audit=app.get(AuditService),original=audit.append.bind(audit);spy=vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{if(entry.action==='LOGIN_PHONE_CHANGED')throw new Error('fixture audit failure');return original(entry,tx);});}
    else {const original=notices.enqueue.bind(notices);spy=vi.spyOn(notices,'enqueue').mockImplementation(async(...args)=>{await original(...args);throw new Error('fixture notice failure after insert');});}
    try{await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(503);}finally{spy.mockRestore();}
    expect((await rows(s)).find(row=>row.identifier===s.oldPhone)?.disabled_at).toBeNull();expect((await rows(s)).some(row=>row.identifier===g.target)).toBe(false);expect(await jobs(s)).toHaveLength(0);await service.verifyToken(s.accessToken);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
  });
  it('two grants replacing the same old phone have one atomic winner',async()=>{
    const s=await account(),a=await start(s),b=await start(s),ca=await targetCode(s,a),cb=await targetCode(s,b);
    const responses=await Promise.all([post(s.accessToken,'confirm',{challenge:a.challenge,code:ca}),post(s.accessToken,'confirm',{challenge:b.challenge,code:cb})]);expect(responses.map(r=>r.status).sort()).toEqual([201,401]);
    expect((await rows(s)).filter(row=>!row.disabled_at)).toHaveLength(1);expect(await jobs(s)).toHaveLength(1);
  });
  it('an old OTP login paused between resolution and session issuance cannot survive successful replacement',async()=>{
    const s=await account(),g=await start(s),code=await targetCode(s,g),resolver=app.get(IdentityResolverService),original=resolver.verifiedLogin.bind(resolver);
    let resume!:()=>void,ready!:()=>void;const reached=new Promise<void>(resolve=>ready=resolve),gate=new Promise<void>(resolve=>resume=resolve);
    const spy=vi.spyOn(resolver,'verifiedLogin').mockImplementation(async(kind,value)=>{const resolved=await original(kind,value);if(value===s.oldPhone){ready();await gate;}return resolved;});
    const pending=service.loginVerified('phone',s.oldPhone,{}).then(()=>true,()=>false);
    try{await reached;await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);resume();expect(await pending).toBe(false);}finally{resume();spy.mockRestore();}
    const [active]=await pool.execute<RowDataPacket[]>('SELECT id FROM auth_sessions WHERE user_id=UUID_TO_BIN(?) AND revoked_at IS NULL',[s.userId]);expect(active).toHaveLength(0);
  });
  it('old number tombstones are excluded from methods/proof sources and cannot be claimed by another account',async()=>{
    const s=await account(),g=await finish(s),current=await service.loginVerified('phone',g.target,{}),m=await methods(current.accessToken),other=await account();
    expect(m.phoneChange.phones).toHaveLength(1);expect(m.phoneChange.phones[0].id).not.toBe(s.oldIdentifierId);expect(m.phoneBinding.sources.some((source:any)=>source.id===s.oldIdentifierId)).toBe(false);
    await post(other.accessToken,'start',{phone:s.oldPhone,oldIdentifierId:other.oldIdentifierId,proof:'password',password}).expect(409);
  });
  it('only one worker dispatches a claimed notice with masked fixed template params and a durable SMS cost reservation',async()=>{
    const s=await account(false);await finishWithEmail(s);await Promise.all([notices.tick(),notices.tick()]);
    const sent=outbound.filter(item=>item.type==='security_notice');expect(sent).toHaveLength(2);expect(sent.find(item=>item.channel==='phone')?.recipient).toBe(s.oldPhone);expect(sent.every(item=>!item.code&&!item.userId&&item.params.oldPhone===maskIdentifier('phone',s.oldPhone))).toBe(true);
    expect((await jobs(s)).every(row=>row.state==='ACCEPTED'&&row.attempts===1)).toBe(true);
    const [attempts]=await pool.execute<RowDataPacket[]>("SELECT state,reserved_fen,accepted_cost_fen FROM auth_sms_attempts WHERE quota_namespace=? AND purpose='security-phone-changed'",[prefix]);expect(attempts).toEqual([expect.objectContaining({state:'ACCEPTED',reserved_fen:10,accepted_cost_fen:3})]);
  });
  async function finishWithEmail(s:Awaited<ReturnType<typeof account>>) {
    const m=await methods(s.accessToken),source=m.phoneChange.sources.find((item:any)=>item.kind==='email'),target=phone();
    const r=await post(s.accessToken,'start',{phone:target,oldIdentifierId:s.oldIdentifierId,proof:'code',identifierId:source.id}).expect(201),challenge=r.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('phone-change-current:'+s.email)}).expect(201);const code=await targetCode(s,{challenge,target});await post(s.accessToken,'confirm',{challenge,code}).expect(201);return {target,challenge};
  }
  it.each(['wrong-id','refused','over-price'])('a %s gateway outcome remains unknown without refund or automatic resend',async mode=>{
    const s=await account();await finish(s);vi.mocked(globalThis.fetch).mockImplementationOnce(async(_url,options)=>{const body=JSON.parse(String(options!.body));return {ok:mode!=='refused',json:async()=>({accepted:true,requestId:mode==='wrong-id'?'wrong-id':body.requestId,providerRequestId:'fixture',costFen:mode==='over-price'?11:3})} as Response;});
    await notices.tick();await notices.tick();expect((await jobs(s))[0].state).toBe('UNKNOWN');
    const [attempts]=await pool.execute<RowDataPacket[]>("SELECT state,reserved_fen FROM auth_sms_attempts WHERE quota_namespace=? AND purpose='security-phone-changed'",[prefix]);expect(attempts).toEqual([expect.objectContaining({state:'UNKNOWN',reserved_fen:10})]);
  });
  it('stalled acknowledgement obeys its real deadline and cannot turn a late result into acceptance',async()=>{
    const s=await account();await finish(s);let release!:(value:unknown)=>void;
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ok:true,json:()=>new Promise(resolve=>release=resolve)} as Response);const started=performance.now();await notices.tick();expect(performance.now()-started).toBeLessThan(7000);release({accepted:true});await Promise.resolve();expect((await jobs(s))[0].state).toBe('UNKNOWN');
  },10000);
  it('budget refusal retries only before dispatch and an expired process claim is never resent',async()=>{
    const s=await account(),g=await finish(s);const config=app.get(ConfigService),original=config.get.bind(config),spy=vi.spyOn(config,'get').mockImplementation((key:string,...rest:any[])=>key==='SMS_LOGIN_GLOBAL_DAILY_LIMIT'?1:original(key,...rest));
    try{await notices.tick();expect((await jobs(s))[0]).toMatchObject({state:'PENDING',attempts:1});expect(outbound.filter(item=>item.type==='security_notice')).toHaveLength(0);}finally{spy.mockRestore();}
    await pool.execute("UPDATE auth_security_notices SET next_attempt_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE user_id=UUID_TO_BIN(?)",[s.userId]);await notices.tick();expect((await jobs(s))[0].state).toBe('ACCEPTED');
    const next=await account();await finish(next);await pool.execute("UPDATE auth_security_notices SET state='CLAIMED',claimed_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE user_id=UUID_TO_BIN(?)",[next.userId]);const count=outbound.length;await notices.tick();expect((await jobs(next))[0].state).toBe('UNKNOWN');expect(outbound.length).toBe(count);expect(g.target).toBeTruthy();
  });
  it('the switch removes replacement capability and prevents new proof/delivery without deleting queued evidence',async()=>{
    const s=await account(),config=app.get(ConfigService),original=config.get.bind(config),spy=vi.spyOn(config,'get').mockImplementation((key:string,...rest:any[])=>key==='AUTH_SECURITY_NOTICE_SEND_ENABLED'?'false':original(key,...rest));
    try{expect((await methods(s.accessToken)).phoneChange.available).toBe(false);await post(s.accessToken,'start',{phone:phone(),oldIdentifierId:s.oldIdentifierId,proof:'password',password}).expect(403);await notices.tick();expect(outbound).toHaveLength(0);}finally{spy.mockRestore();}
  });
  it('adding a first password or changing the proof source invalidates a password-free grant',async()=>{
    for(const action of ['password','source']){
      const s=await account(false),m=await methods(s.accessToken),source=m.phoneChange.sources.find((item:any)=>item.kind==='email');
      const r=await post(s.accessToken,'start',{phone:phone(),oldIdentifierId:s.oldIdentifierId,proof:'code',identifierId:source.id}).expect(201),challenge=r.body.challenge;
      await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('phone-change-current:'+s.email)}).expect(201);
      if(action==='password')await service.setInitialPassword(s.userId,s.email,password);else await pool.execute('UPDATE login_identifiers SET verified_at=DATE_ADD(verified_at,INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[source.id]);
      await post(s.accessToken,'target/request',{challenge}).expect(401);
    }
  });
  it('five wrong new-channel attempts exhaust the actual OTP, including across a limiter window',async()=>{
    const s=await account(),g=await start(s),code=await targetCode(s,g),wrong=code==='000000'?'999999':'000000';
    for(let index=0;index<5;index++)await post(s.accessToken,'confirm',{challenge:g.challenge,code:wrong}).expect(401);
    clock.mockReturnValue(Date.now()+301000);await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(429);expect((await rows(s)).find(row=>row.identifier===s.oldPhone)?.disabled_at).toBeNull();
  });
  it('switching off delivery after cost reservation cancels before the outbound POST',async()=>{
    const s=await account();await finish(s);const sms=app.get(SmsCodeDeliveryService),reserve=sms.reserve.bind(sms),config=app.get(ConfigService),get=config.get.bind(config);let flag:ReturnType<typeof vi.spyOn>|undefined;
    const spy=vi.spyOn(sms,'reserve').mockImplementation(async(...args)=>{const r=await reserve(...args);flag=vi.spyOn(config,'get').mockImplementation((key:string,...rest:any[])=>key==='AUTH_SECURITY_NOTICE_SEND_ENABLED'?'false':get(key,...rest));return r;});
    try{await notices.tick();expect(outbound.filter(item=>item.type==='security_notice')).toHaveLength(0);expect((await jobs(s))[0].state).toBe('PENDING');}finally{flag?.mockRestore();spy.mockRestore();}
    const [attempts]=await pool.execute<RowDataPacket[]>("SELECT state FROM auth_sms_attempts WHERE quota_namespace=? AND purpose='security-phone-changed'",[prefix]);expect(attempts[0].state).toBe('CANCELLED');
  });
  it('persistent budget refusal stops after five pre-dispatch attempts, while queued recipient tampering is blocked',async()=>{
    const s=await account();await finish(s);const config=app.get(ConfigService),get=config.get.bind(config),spy=vi.spyOn(config,'get').mockImplementation((key:string,...rest:any[])=>key==='SMS_LOGIN_GLOBAL_DAILY_LIMIT'?1:get(key,...rest));
    try{for(let i=0;i<5;i++){await pool.execute('UPDATE auth_security_notices SET next_attempt_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE user_id=UUID_TO_BIN(?)',[s.userId]);await notices.tick();}expect((await jobs(s))[0]).toMatchObject({state:'BLOCKED',attempts:5});}finally{spy.mockRestore();}
    const other=await account();await finish(other);await pool.execute("UPDATE auth_security_notices SET recipient_cipher='invalid' WHERE user_id=UUID_TO_BIN(?)",[other.userId]);const count=outbound.length;await notices.tick();expect((await jobs(other))[0].state).toBe('BLOCKED');expect(outbound.length).toBe(count);
  });
  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome password and password-free replacement force fresh login to the original account; disabled entry stays hidden',async()=>{
    const {chromium}=await import('playwright-core'),{createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path');
    const dist=path.resolve(process.cwd(),'../mobile/dist'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    const server=createServer((req,res)=>{const requested=path.resolve(dist,'.'+new URL(req.url!,'http://localhost').pathname),file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as any).port;
    const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true});
    try{
      for(const withPassword of [true,false]){
        const s=await account(withPassword),target=phone(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();let loggedIn='';
        page.setDefaultTimeout(15000);await page.route('http://127.0.0.1:3001/api/**',async route=>{try{const url=new URL(route.request().url()),response=await route.fetch({url:base+url.pathname+url.search,timeout:15000});if(['/api/auth/login','/api/auth/code/verify'].includes(url.pathname)&&response.status()===201)loggedIn=(await response.json()).userId;await route.fulfill({response});}catch(error){if(!/already handled|closed/.test(String(error)))throw error;}});
        try{
          if(withPassword){await page.goto(origin+'/auth/password-login');await page.getByLabel('邮箱账号',{exact:true}).fill(s.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();}
          else{await page.goto(origin+'/auth/login');await page.getByRole('textbox',{name:'邮箱',exact:true}).fill(s.email);await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor();await page.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+s.email)!);await page.getByRole('button',{name:'验证并登录',exact:true}).click();}
          await page.waitForURL('**/schedule');await page.getByRole('button',{name:'我的',exact:true}).first().click();await page.getByRole('button',{name:/账号与登录/}).click();await page.getByRole('button',{name:/更换登录手机号/}).click();
          await page.getByLabel('新手机号',{exact:true}).fill(target);if(withPassword)await page.getByPlaceholder('当前账号密码',{exact:true}).fill(password);else await page.getByRole('radio').filter({hasText:'手机号 · '+maskIdentifier('phone',s.oldPhone)}).click();
          await page.screenshot({path:path.join(screenshots,'m3-change-'+(withPassword?'password':'code')+'-current.png'),fullPage:true});
          await page.getByRole('button',{name:withPassword?'验证当前账号':'发送当前账号验证码',exact:true}).click();
          if(!withPassword){const field=page.getByLabel('当前账号验证码',{exact:true});await field.waitFor();const currentCode=deliveries.get('phone-change-current:'+s.oldPhone);expect(currentCode).toMatch(/^\d{6}$/);await field.fill(currentCode!);await page.getByRole('button',{name:'确认当前账号',exact:true}).click();}
          await page.getByRole('button',{name:'获取新手机号验证码',exact:true}).click();await page.getByText('短信请求已受理，请留意短信。验证码 5 分钟内有效。',{exact:true}).waitFor();await page.getByLabel('新手机号验证码',{exact:true}).fill(deliveries.get('phone-change-target:'+target)!);
          await page.screenshot({path:path.join(screenshots,'m3-change-'+(withPassword?'password':'code')+'-target.png'),fullPage:true});await page.getByRole('button',{name:'确认换号并重新登录',exact:true}).click();await page.waitForURL('**/auth/login?reason=phone-changed');
          await page.getByText(/手机号已更换，所有设备已退出/).filter({visible:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m3-change-'+(withPassword?'password':'code')+'-relogin.png'),fullPage:true});
          await expect(service.verifyToken(s.accessToken)).rejects.toMatchObject({status:401});
          await pool.execute("DELETE FROM auth_sms_quotas WHERE quota_namespace=? AND bucket='interval'",[prefix]);const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
          await page.getByRole('tab',{name:'手机号',exact:true}).filter({visible:true}).click();await page.getByLabel('手机号码',{exact:true}).fill(target);await page.getByRole('button',{name:'获取验证码',exact:true}).filter({visible:true}).click();await page.getByText('短信请求已受理，请留意短信。验证码 5 分钟内有效。',{exact:true}).filter({visible:true}).waitFor();await page.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+target)!);await page.getByRole('button',{name:'验证并登录',exact:true}).filter({visible:true}).click();await page.waitForURL('**/schedule');expect(loggedIn).toBe(s.userId);
          await page.getByRole('button',{name:'我的',exact:true}).first().click();await page.getByRole('button',{name:/账号与登录/}).click();await page.getByText('换号安全通知',{exact:true}).waitFor();await page.getByText(/等待发送/).first().waitFor();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
          if(withPassword){const config=app.get(ConfigService),get=config.get.bind(config),flag=vi.spyOn(config,'get').mockImplementation((key:string,...rest:any[])=>key==='AUTH_PHONE_CHANGE_ENABLED'?'false':get(key,...rest));try{const loaded=page.waitForResponse(async response=>response.url().includes('/api/auth/security/methods')&&response.status()===200&&(await response.json()).phoneChange.available===false);await page.getByRole('button',{name:'返回',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:/账号与登录/}).click();await loaded;expect(await page.getByRole('button',{name:/更换登录手机号/}).filter({visible:true}).count()).toBe(0);}finally{flag.mockRestore();}}
        }finally{await page.unrouteAll({behavior:'ignoreErrors'});await context.close();}
      }
    }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  },120000);
});
