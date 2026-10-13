import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { PhoneBindingService } from '../src/auth/phone-binding.service';
import { EmailBindingService } from '../src/auth/email-binding.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { RateLimiterService } from '../src/infrastructure/rate-limiter.service';
import { AuditService } from '../src/audit/audit.service';

describe.sequential('M3-01 safe new phone binding on real SQL and Redis', () => {
  let app: INestApplication, pool: Pool, service: AuthService, binding: PhoneBindingService, codes: LoginCodeService, redis: IORedis;
  const keys = ['AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_PHONE_BIND_ENABLED','AUTH_EMAIL_BIND_ENABLED','EMAIL_LOGIN_DELIVERY_ENDPOINT','SMS_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const deliveries = new Map<string,string>();
  const password = 'correct-horse-battery-staple';
  const email = () => 'phone-bind-' + randomUUID() + '@example.test';
  const phone = () => '+86139' + String(Math.floor(Math.random()*100000000)).padStart(8,'0');
  let prefix: string;
  let budgetClock: {mockRestore:()=>void};
  beforeAll(async () => {
    process.env.AUTH_PASSWORD_CREDENTIAL_MODE = 'UNIFIED'; process.env.AUTH_PHONE_BIND_ENABLED = 'true'; process.env.PUBLIC_REGISTRATION = 'true';
    process.env.AUTH_EMAIL_BIND_ENABLED = 'true';
    process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT = process.env.SMS_LOGIN_DELIVERY_ENDPOINT = 'https://binding-delivery.fixture.test';
    process.env.LOGIN_CODE_DELIVERY_TOKEN = 'private-binding-fixture-token';
    prefix = process.env.REDIS_KEY_PREFIX! + ':phone-binding-tests';
    process.env.REDIS_KEY_PREFIX = process.env.TEST_REDIS_KEY_PREFIX = prefix;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (String(url) !== process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT) throw new Error('Unexpected outbound request');
      expect(options.redirect).toBe('error');
      const body = JSON.parse(String(options.body)); deliveries.set(body.purpose + ':' + body.recipient, body.code);
      return {ok:true};
    }));
    ({app,pool} = await bootP2App('phone-binding'));
    service = app.get(AuthService); binding = app.get(PhoneBindingService); codes = app.get(LoginCodeService); redis = new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async () => {
    // Keep fixed-window budget assertions in one window. Redis TTLs and timers
    // remain real; the boundary regression explicitly advances this clock.
    budgetClock = vi.spyOn(Date,'now').mockReturnValue(Date.now());
    // Reset only this suite's random, isolated budgets between independent cases.
    const budgets = await redis.keys(prefix + ':ratelimit:*'); if (budgets.length) await redis.del(...budgets);
  });
  afterEach(() => budgetClock?.mockRestore());
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); await redis?.quit(); await pool?.end(); await app?.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });
  const post = (token: string, path: string, body: unknown) => request(app.getHttpServer()).post('/api/auth/phone-binding/' + path).set(auth(token)).send(body);
  async function account() { const address = email(); return {...await service.register({email:address,password,displayName:'Binding fixture'}),email:address}; }
  async function noPassword(kind: 'email'|'phone' = 'email') {
    const address = kind === 'email' ? email() : '+86139' + String(Math.floor(Math.random()*100000000)).padStart(8,'0');
    return {...await service.loginVerified(kind,address,{}),email:address};
  }
  async function start(session: {accessToken:string}, target = phone()) {
    const result = await post(session.accessToken,'start',{phone:target,proof:'password',password}).expect(201);
    expect(result.body).toMatchObject({stage:'target',challengeExpiresIn:600});
    return {challenge:result.body.challenge as string,target};
  }
  async function targetCode(session:{accessToken:string}, grant:{challenge:string;target:string}) {
    await post(session.accessToken,'target/request',{challenge:grant.challenge}).expect(201);
    return deliveries.get('phone-bind-target:' + grant.target)!;
  }
  async function methods(token: string) { return (await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(token)).expect(200)).body; }
  async function owner(address: string) {
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT BIN_TO_UUID(user_id) AS userId FROM login_identifiers WHERE kind='phone' AND identifier=?",[address]);
    return rows[0]?.userId;
  }
  async function grantKey(challenge: string) { return (binding as any).key(challenge) as string; }
  async function releaseSendBudget() { const budgets = await redis.keys(prefix + ':ratelimit:*'); if (budgets.length) await redis.del(...budgets); }

  it('password + new phone proofs bind to the original user, OTP/password both enter the same data', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g);
    const [before] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,display_name FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
    expect(await owner(g.target)).toBe(s.userId);
    expect((await service.login({kind:'phone',identifier:g.target,password},{})).userId).toBe(s.userId);
    await releaseSendBudget(); await codes.request({kind:'phone',identifier:g.target},'binding-login');
    const logged = await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'phone',identifier:g.target,code:deliveries.get('login:'+g.target)}).expect(201);
    expect(logged.body.userId).toBe(s.userId); expect(logged.body.firstLogin).toBe(false);
    const [after] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,display_name FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]); expect(after).toEqual(before);
    expect((await service.login({email:s.email,password},{})).userId).toBe(s.userId);
  });
  it.each(['email','phone'] as const)('a password-free %s user verifies its existing channel and binds a phone without creating a password', async kind => {
    const s = await noPassword(kind), m = await methods(s.accessToken), target = phone();
    expect(m.passwordConfigured).toBe(false);
    const result = await post(s.accessToken,'start',{phone:target,proof:'code',identifierId:m.phoneBinding.sources[0].id}).expect(201), challenge = result.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('phone-bind-current:'+s.email)}).expect(201);
    const code = await targetCode(s,{challenge,target}); await post(s.accessToken,'confirm',{challenge,code}).expect(201);
    expect(await owner(target)).toBe(s.userId); expect((await methods(s.accessToken)).passwordConfigured).toBe(false);
  });
  it('does not offer an unverified legacy inbox as current-account OTP proof', async () => {
    const s = await account(), m = await methods(s.accessToken);
    expect(m.phoneBinding.sources).toEqual([]);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id FROM auth_identities WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'start',{phone:phone(),proof:'code',identifierId:rows[0].id}).expect(401);
  });
  it('cannot select a source owned by another user or a client-supplied user/session/target', async () => {
    const s = await account(), other = await noPassword(), m = await methods(other.accessToken);
    await post(s.accessToken,'start',{phone:phone(),proof:'code',identifierId:m.phoneBinding.sources[0].id}).expect(401);
    for (const extra of [{userId:other.userId},{sessionId:randomUUID()}]) await post(s.accessToken,'start',{phone:phone(),proof:'password',password,...extra}).expect(400);
    const g = await start(s); await post(s.accessToken,'target/request',{challenge:g.challenge,phone:phone()}).expect(400);
  });
  it('requires exactly one current-account proof and refuses a wrong password before delivery', async () => {
    const s = await account(), fetch = vi.mocked(globalThis.fetch), before = fetch.mock.calls.length;
    await post(s.accessToken,'start',{phone:phone(),proof:'password',password:'wrong-password'}).expect(401);
    await post(s.accessToken,'start',{phone:phone(),proof:'password',password,identifierId:randomUUID()}).expect(400);
    await post(s.accessToken,'start',{phone:phone(),proof:'code',identifierId:randomUUID(),password}).expect(400);
    expect(fetch.mock.calls.length).toBe(before);
  });
  it('rejects another user and another live session without consuming the original grant', async () => {
    const s = await account(), other = await account(), second = await service.login({email:s.email,password},{}), g = await start(s);
    await post(other.accessToken,'target/request',{challenge:g.challenge}).expect(401);
    await post(second.accessToken,'target/request',{challenge:g.challenge}).expect(401);
    const code = await targetCode(s,g); await post(second.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
  });
  it('refresh rotates the server session and invalidates the old binding proof', async () => {
    const s = await account(), g = await start(s), refreshed = await service.refresh(s.refreshToken,{});
    const result = await post(refreshed.accessToken,'target/request',{challenge:g.challenge}).expect(401); expect(result.body.code).toBe('PHONE_BIND_PROOF_EXPIRED');
    expect(await owner(g.target)).toBeUndefined();
  });
  it.each(['logout','disabled','expired-session'] as const)('%s prevents a guarded write even with a previously validated server context', async action => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), user = await service.verifyToken(s.accessToken);
    if (action === 'logout') await service.logout(s.refreshToken);
    if (action === 'disabled') await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
    if (action === 'expired-session') await pool.execute('UPDATE auth_sessions SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE),expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE id=UUID_TO_BIN(?)',[user.sessionId]);
    await expect(binding.confirm(user,g.challenge,code,'guarded-'+action)).rejects.toMatchObject({response:{code:'PHONE_BIND_PROOF_EXPIRED'}});
    await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(401);
    expect(await owner(g.target)).toBeUndefined();
  });
  it('a credential version change invalidates proofs even when its hash remains the same', async () => {
    const s = await account(), g = await start(s);
    await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(401);
  });
  it('adding the first password invalidates a password-free binding proof', async () => {
    const s = await noPassword(), m = await methods(s.accessToken), target = phone();
    const result = await post(s.accessToken,'start',{phone:target,proof:'code',identifierId:m.phoneBinding.sources[0].id}).expect(201), challenge = result.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('phone-bind-current:'+s.email)}).expect(201);
    await service.setInitialPassword(s.userId,s.email,password);
    await post(s.accessToken,'target/request',{challenge}).expect(401);
  });
  it('revoking or changing source ownership invalidates OTP proof', async () => {
    const s = await noPassword(), other = await account(), m = await methods(s.accessToken), id = m.phoneBinding.sources[0].id;
    const r = await post(s.accessToken,'start',{phone:phone(),proof:'code',identifierId:id}).expect(201);
    await pool.execute('UPDATE login_identifiers SET user_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)',[other.userId,id]);
    await post(s.accessToken,'current/confirm',{challenge:r.body.challenge,code:deliveries.get('phone-bind-current:'+s.email)}).expect(401);
  });
  it('expired and replayed grants fail closed; one success produces one audit', async () => {
    const s = await account(), expired = await start(s);
    const key = await grantKey(expired.challenge), state = JSON.parse((await redis.get(key))!); state.expiresAt = Date.now()-1; await redis.set(key,JSON.stringify(state),'EX',60);
    await post(s.accessToken,'target/request',{challenge:expired.challenge}).expect(401);
    const g = await start(s), code = await targetCode(s,g); await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
    const [logs] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_PHONE_BOUND'",[s.userId]); expect(Number(logs[0].n)).toBe(1);
  });
  it('login, current-account, target and another challenge codes are isolated', async () => {
    const s = await noPassword(), m = await methods(s.accessToken), target = phone();
    const r = await post(s.accessToken,'start',{phone:target,proof:'code',identifierId:m.phoneBinding.sources[0].id}).expect(201), challenge = r.body.challenge, current = deliveries.get('phone-bind-current:'+s.email)!;
    await post(s.accessToken,'target/request',{challenge}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:s.email,code:current}).expect(401);
    await post(s.accessToken,'current/confirm',{challenge,code:current}).expect(201);
    await post(s.accessToken,'confirm',{challenge,code:current}).expect(401); // No target code exists.
    const s2 = await account(), g2 = await start(s2,target), targetOtp = await targetCode(s2,g2);
    await post(s.accessToken,'confirm',{challenge,code:targetOtp}).expect(401); // Another context, same target.
    await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'phone',identifier:target,code:targetOtp}).expect(401);
    expect(await owner(target)).toBeUndefined();
  });
  it('wrong target OTP attempts exhaust a bounded budget', async () => {
    const s = await account(), g = await start(s);
    const actual = await targetCode(s,g), wrong = actual === '999999' ? '888888' : '999999';
    for (let n=0;n<5;n++) await post(s.accessToken,'confirm',{challenge:g.challenge,code:wrong}).expect(401);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code:actual}).expect(429);
  });
  it('five attempts on one OTP remain exhausted across a fixed-window boundary', async () => {
    const s = await account(), g = await start(s), actual = await targetCode(s,g), wrong = actual === '999999' ? '888888' : '999999';
    const boundary = Math.ceil(Date.now()/300000)*300000;
    const clock = vi.spyOn(Date,'now').mockReturnValue(boundary-1000);
    try {
      for(let n=0;n<2;n++) await post(s.accessToken,'confirm',{challenge:g.challenge,code:wrong}).expect(401);
      clock.mockReturnValue(boundary+1000);
      for(let n=0;n<3;n++) await post(s.accessToken,'confirm',{challenge:g.challenge,code:wrong}).expect(401);
      await post(s.accessToken,'confirm',{challenge:g.challenge,code:actual}).expect(429);
      expect(await owner(g.target)).toBeUndefined();
    } finally { clock.mockRestore(); }
  });
  it('wrong existing-channel codes have a bounded budget and cannot promote the grant', async () => {
    const s = await noPassword(), m = await methods(s.accessToken);
    const r = await post(s.accessToken,'start',{phone:phone(),proof:'code',identifierId:m.phoneBinding.sources[0].id}).expect(201), challenge = r.body.challenge;
    const wrong = deliveries.get('phone-bind-current:'+s.email) === '999999' ? '888888' : '999999';
    for(let n=0;n<5;n++) await post(s.accessToken,'current/confirm',{challenge,code:wrong}).expect(401);
    await post(s.accessToken,'current/confirm',{challenge,code:wrong}).expect(429);
    await post(s.accessToken,'target/request',{challenge}).expect(401);
  });
  it('current-password attempts share a user budget across target phone numbers', async () => {
    const s = await account();
    for(let n=0;n<10;n++) await post(s.accessToken,'start',{phone:phone(),proof:'password',password:'wrong-password'}).expect(401);
    await post(s.accessToken,'start',{phone:phone(),proof:'password',password}).expect(429);
  });
  it('identifier send budgets are shared across login and binding purposes', async () => {
    const s = await account(), g = await start(s); await targetCode(s,g);
    await request(app.getHttpServer()).post('/api/auth/code/request').send({kind:'phone',identifier:g.target}).expect(429);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(429);
  });
  it('an occupied phone, including this user’s existing phone, is never transferred or merged', async () => {
    const s = await account(), known = await noPassword('phone');
    await post(s.accessToken,'start',{phone:known.email,proof:'password',password}).expect(409);
    expect(await owner(known.email)).toBe(known.userId);
    expect((await service.loginVerified('phone',known.email,{})).userId).toBe(known.userId);
    await post(known.accessToken,'start',{phone:known.email,proof:'code',identifierId:(await methods(known.accessToken)).phoneBinding.sources[0].id}).expect(409);
  });
  it('parallel users cannot both bind one target', async () => {
    const a = await account(), b = await account(), target = phone(), ga = await start(a,target), gb = await start(b,target);
    const ca = await targetCode(a,ga); await releaseSendBudget(); const cb = await targetCode(b,gb);
    const results = await Promise.all([post(a.accessToken,'confirm',{challenge:ga.challenge,code:ca}),post(b.accessToken,'confirm',{challenge:gb.challenge,code:cb})]);
    expect(results.map(r=>r.status).sort()).toEqual([201,409]); expect([a.userId,b.userId]).toContain(await owner(target));
  });
  it('parallel confirmations consume a grant once', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g);
    const results = await Promise.all([post(s.accessToken,'confirm',{challenge:g.challenge,code}),post(s.accessToken,'confirm',{challenge:g.challenge,code})]);
    expect(results.map(r=>r.status).sort()).toEqual([201,401]); expect(await owner(g.target)).toBe(s.userId);
  });
  it('binding races with anonymous OTP using the same unique-index locks', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g);
    const results = await Promise.allSettled([binding.confirm(await service.verifyToken(s.accessToken),g.challenge,code,'anonymous-race'),service.loginVerified('phone',g.target,{})]);
    const winner = await owner(g.target); expect(winner).toBeTruthy();
    if (results[0].status === 'fulfilled') expect(winner).toBe(s.userId);
    else expect(results[0].reason).toMatchObject({response:{code:'PHONE_BIND_OCCUPIED'}});
    expect(results[1].status).toBe('fulfilled'); if (results[1].status === 'fulfilled') expect(results[1].value.userId).toBe(winner);
  });
  it('audit failure rolls back identifier and audit, consumes proofs and requires a fresh workflow', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), audit = app.get(AuditService), append = audit.append.bind(audit);
    const spy = vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{ if(entry.action==='LOGIN_PHONE_BOUND') throw new Error('private-audit-fixture'); return append(entry,tx); });
    try { const r = await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(503); expect(JSON.stringify(r.body)).not.toContain('private-audit-fixture'); } finally { spy.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined(); await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
    const [logs] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_PHONE_BOUND'",[s.userId]); expect(Number(logs[0].n)).toBe(0);
    await releaseSendBudget(); const fresh = await start(s,g.target), freshCode = await targetCode(s,fresh); await post(s.accessToken,'confirm',{challenge:fresh.challenge,code:freshCode}).expect(201);
  });
  it('the final SQL write rechecks a credential changed after Redis proof consumption', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), original = (binding as any).validate.bind(binding);
    const spy = vi.spyOn(binding as any,'validate').mockImplementation(async(user:any,state:any,tx:any)=>{
      if(tx) await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
      return original(user,state,tx);
    });
    try { await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401); } finally { spy.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined();
  });
  it('the final SQL write rechecks a session revoked after Redis proof consumption', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), original = (binding as any).validate.bind(binding);
    const spy = vi.spyOn(binding as any,'validate').mockImplementation(async(user:any,state:any,tx:any)=>{
      if(tx) await service.logout(s.refreshToken);
      return original(user,state,tx);
    });
    try { await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401); } finally { spy.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined();
  });
  it('target delivery failure clears its code and permits retry only after the shared cooldown', async () => {
    const s = await account(), g = await start(s), fetch = vi.mocked(globalThis.fetch);
    fetch.mockResolvedValueOnce({ok:false} as Response);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(503);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code:'999999'}).expect(401);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(429);
    await releaseSendBudget(); const code = await targetCode(s,g); await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
  });
  it('anonymous callers cannot create or spend binding challenges', async () => {
    await request(app.getHttpServer()).post('/api/auth/phone-binding/start').send({phone:phone(),proof:'password',password}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/phone-binding/confirm').send({challenge:'a'.repeat(64),code:'123456'}).expect(401);
  });
  it('the rollout flag hides the entry and rejects new binding while retaining existing login', async () => {
    const s = await account(), config = (binding as any).config, get = config.get.bind(config);
    const spy = vi.spyOn(config,'get').mockImplementation((...args:any[])=>args[0]==='AUTH_PHONE_BIND_ENABLED'?'false':get(...args));
    try {
      expect((await methods(s.accessToken)).phoneBinding).toEqual({available:false,sources:[]});
      await post(s.accessToken,'start',{phone:phone(),proof:'password',password}).expect(403);
      expect((await service.login({email:s.email,password},{})).userId).toBe(s.userId);
    } finally { spy.mockRestore(); }
  });
  it('Redis or limiter failures cannot deliver target codes or write identifiers', async () => {
    const s = await account(), g = await start(s), client = (binding as any).redis as IORedis;
    const spy = vi.spyOn(client,'get').mockRejectedValue(new Error('private-redis-outage'));
    try { const r = await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(503); expect(JSON.stringify(r.body)).not.toContain('private-redis-outage'); } finally { spy.mockRestore(); }
    const limiter = vi.spyOn(app.get(RateLimiterService),'consume').mockRejectedValue(new Error('private-limiter-outage'));
    try { await post(s.accessToken,'start',{phone:phone(),proof:'password',password}).expect(503); } finally { limiter.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined();
  });
  it('HTTP and Redis expose neither password hashes nor OTPs nor the raw grant in a key', async () => {
    const s = await account(), g = await start(s), key = await grantKey(g.challenge), raw = (await redis.get(key))!;
    expect(key).not.toContain(g.challenge); expect(raw).not.toContain(password); expect(raw).not.toContain('$2'); expect(raw).not.toContain(g.challenge);
    await targetCode(s,g); const m = await methods(s.accessToken);
    expect(JSON.stringify(m)).not.toMatch(/passwordHash|passwordEpoch|sourceLegacyIdentityId|credentialId/); expect(JSON.parse(raw)).not.toHaveProperty('code');
  });

  it('normalizes mainland numbers and rejects malformed or foreign targets before delivery', async () => {
    const s = await account(), target = phone();
    const g = await start(s,target.slice(3));
    const code = await targetCode(s,{...g,target});
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
    expect(await owner(target)).toBe(s.userId);
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    for (const invalid of ['+14155552671','12345678901','12012345678','1390013900']) await post(s.accessToken,'start',{phone:invalid,proof:'password',password}).expect(400);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
  });
  it('email and phone grants cannot be spent in each other’s routes', async () => {
    const s = await account(), g = await start(s), emailBinding = app.get(EmailBindingService);
    const e = await emailBinding.start(await service.verifyToken(s.accessToken),{email:email(),proof:'password',password},'cross-kind');
    await request(app.getHttpServer()).post('/api/auth/email-binding/target/request').set(auth(s.accessToken)).send({challenge:g.challenge}).expect(401);
    await post(s.accessToken,'target/request',{challenge:e.challenge}).expect(401);
    const code = await targetCode(s,g);
    await request(app.getHttpServer()).post('/api/auth/email-binding/confirm').set(auth(s.accessToken)).send({challenge:g.challenge,code}).expect(401);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
  });
  it('password guesses share one account budget across both binding types', async () => {
    const s = await account();
    for(let n=0;n<5;n++) {
      await post(s.accessToken,'start',{phone:phone(),proof:'password',password:'wrong-password'}).expect(401);
      await request(app.getHttpServer()).post('/api/auth/email-binding/start').set(auth(s.accessToken)).send({email:email(),proof:'password',password:'wrong-password'}).expect(401);
    }
    await post(s.accessToken,'start',{phone:phone(),proof:'password',password}).expect(429);
  });
  it('a target claimed after current proof blocks delivery and binding without transferring it', async () => {
    const s = await account(), g = await start(s), other = await service.loginVerified('phone',g.target,{}), before = vi.mocked(globalThis.fetch).mock.calls.length;
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(409);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
    expect(await owner(g.target)).toBe(other.userId);
  });

  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome password and password-free binding preserve the original account on phone login', async () => {
    const s = await account(), target = phone();
    const {chromium} = await import('playwright-core'), {createServer} = await import('node:http'), {readFileSync,existsSync,writeFileSync} = await import('node:fs'), path = await import('node:path');
    const root = path.resolve(process.cwd(),'../..'), dist = path.join(root,'apps/mobile/dist'), screenshots = process.env.AUTH_V2_SCREENSHOT_DIR!;
    await app.listen(0,'127.0.0.1'); const apiBase = await app.getUrl();
    const server = createServer((req,res)=>{
      const requested = path.resolve(dist,'.'+decodeURIComponent(new URL(req.url!,'http://localhost').pathname));
      const file = requested.startsWith(dist+path.sep) && existsSync(requested) && path.extname(requested) ? requested : path.join(dist,'index.html');
      res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html'); res.end(readFileSync(file));
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser = await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true});
    const mark = (phase:string) => writeFileSync(path.join(screenshots,'m3-phone-bind-browser-phase.json'),JSON.stringify({phase,at:new Date().toISOString()}));
    const closingPages = new WeakSet<import('playwright-core').Page>();
    const closeContext = async (context:import('playwright-core').BrowserContext) => {
      for(const page of context.pages()) { closingPages.add(page); await page.unrouteAll({behavior:'ignoreErrors'}); }
      await context.close();
    };
    try {
      const context = await browser.newContext({viewport:{width:390,height:844}}), page = await context.newPage(); let signedInUser = '';
      page.setDefaultTimeout(15000);
      const bridgeFailures: string[] = [];
      const bridge = async (route: import('playwright-core').Route) => {
        try {
          const url = new URL(route.request().url()), response = await route.fetch({url:apiBase+url.pathname+url.search,timeout:15000});
          if(['/api/auth/login','/api/auth/code/verify'].includes(url.pathname)&&response.status()===201) signedInUser=(await response.json()).userId;
          await route.fulfill({response});
        } catch(error) {
          // React Query cancels reads on navigation, and teardown cancels pending
          // requests. Required auth outcomes are independently awaited below.
          if(!closingPages.has(route.request().frame().page()) && !/Route is already handled|Target page, context or browser has been closed/.test(String(error))) bridgeFailures.push('API_BRIDGE_FAILED');
        }
      };
      await page.route('http://127.0.0.1:3001/api/**',bridge);
      const origin = 'http://127.0.0.1:'+(server.address() as any).port;
      await page.goto(origin+'/auth/password-login'); await page.getByLabel('邮箱账号',{exact:true}).fill(s.email); await page.getByLabel('密码',{exact:true}).fill(password);
      await page.getByRole('button',{name:'登录',exact:true}).click(); await page.waitForURL('**/schedule');
      await page.getByRole('button',{name:'我的',exact:true}).first().click(); await page.getByRole('button',{name:/账号与登录/}).click();
      await page.getByRole('button',{name:/添加登录手机号/}).click(); await page.getByLabel('新手机号',{exact:true}).fill(target); await page.getByLabel('当前密码',{exact:true}).fill(password);
      await page.screenshot({path:path.join(screenshots,'m3-phone-bind-current.png'),fullPage:true});
      await page.getByRole('button',{name:'验证当前账号',exact:true}).click();
      await page.getByRole('button',{name:'获取新手机号验证码',exact:true}).click(); await page.getByText('验证码已发送，5 分钟内有效。',{exact:true}).waitFor();
      await page.getByLabel('新手机号验证码',{exact:true}).fill(deliveries.get('phone-bind-target:'+target)!);
      await page.screenshot({path:path.join(screenshots,'m3-phone-bind-target.png'),fullPage:true});
      await page.getByRole('button',{name:'验证并绑定手机号',exact:true}).click(); await page.getByRole('button',{name:'返回账号与验证',exact:true}).waitFor();
      await page.screenshot({path:path.join(screenshots,'m3-phone-bind-success.png'),fullPage:true}); expect(await owner(target)).toBe(s.userId);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      mark('PASSWORD_BOUND');
      await closeContext(context); const second = await browser.newContext(), page2 = await second.newPage();
      page2.setDefaultTimeout(15000);
      await page2.route('http://127.0.0.1:3001/api/**',bridge);
      await page2.goto(origin+'/auth/password-login'); await page2.getByRole('tab',{name:'手机号',exact:true}).click(); await page2.getByLabel('手机号账号',{exact:true}).fill(target); await page2.getByLabel('密码',{exact:true}).fill(password);
      await page2.getByRole('button',{name:'登录',exact:true}).click(); await page2.waitForURL('**/schedule'); expect(signedInUser).toBe(s.userId); await closeContext(second);
      mark('PASSWORD_ALIAS_LOGIN_COMPLETE');
      // The password-optional path is exercised through the same real UI/API.
      const otpUser = await noPassword(), otpTarget = phone(), third = await browser.newContext({viewport:{width:390,height:844}}), page3 = await third.newPage();
      page3.setDefaultTimeout(15000);
      await page3.route('http://127.0.0.1:3001/api/**',bridge);
      await page3.goto(origin+'/auth/login'); await page3.getByRole('textbox',{name:'邮箱',exact:true}).fill(otpUser.email);
      mark('OTP_LOGIN_SEND');
      await page3.getByRole('button',{name:'获取验证码',exact:true}).click(); await page3.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor();
      await page3.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+otpUser.email)!); await page3.getByRole('button',{name:'验证并登录',exact:true}).click(); await page3.waitForURL('**/schedule'); expect(signedInUser).toBe(otpUser.userId);
      mark('OTP_ORIGINAL_LOGIN_COMPLETE');
      await page3.getByRole('button',{name:'我的',exact:true}).first().click(); await page3.getByRole('button',{name:/账号与登录/}).click(); await page3.getByRole('button',{name:/添加登录手机号/}).click();
      await page3.getByLabel('新手机号',{exact:true}).fill(otpTarget); await page3.getByRole('button',{name:'发送当前账号验证码',exact:true}).waitFor();
      mark('OTP_CURRENT_SEND');
      await releaseSendBudget(); await page3.getByRole('button',{name:'发送当前账号验证码',exact:true}).click(); await page3.getByLabel('当前账号验证码',{exact:true}).waitFor();
      await page3.getByLabel('当前账号验证码',{exact:true}).fill(deliveries.get('phone-bind-current:'+otpUser.email)!);
      await page3.screenshot({path:path.join(screenshots,'m3-phone-bind-password-free-current.png'),fullPage:true});
      await page3.getByRole('button',{name:'确认当前账号',exact:true}).click(); await page3.getByRole('button',{name:'获取新手机号验证码',exact:true}).click(); await page3.getByText('验证码已发送，5 分钟内有效。',{exact:true}).waitFor();
      mark('OTP_TARGET_SENT');
      await page3.getByLabel('新手机号验证码',{exact:true}).fill(deliveries.get('phone-bind-target:'+otpTarget)!); await page3.getByRole('button',{name:'验证并绑定手机号',exact:true}).click();
      await page3.getByRole('button',{name:'返回账号与验证',exact:true}).waitFor(); expect(await owner(otpTarget)).toBe(otpUser.userId);
      mark('OTP_PHONE_BOUND');
      await page3.screenshot({path:path.join(screenshots,'m3-phone-bind-password-free-success.png'),fullPage:true}); expect(await page3.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page3.getByRole('button',{name:'返回账号与验证',exact:true}).click(); await page3.getByText(/手机号 ·/).filter({visible:true}).first().waitFor(); await page3.getByText('可选设置，也可继续使用验证码',{exact:true}).filter({visible:true}).first().waitFor();
      await page3.screenshot({path:path.join(screenshots,'m3-phone-bind-password-free-security.png'),fullPage:true});
      await closeContext(third);
      const fourth = await browser.newContext(), page4 = await fourth.newPage(); await page4.route('http://127.0.0.1:3001/api/**',bridge);
      page4.setDefaultTimeout(15000);
      await releaseSendBudget(); await page4.goto(origin+'/auth/login'); await page4.getByRole('tab',{name:'手机号',exact:true}).click(); await page4.getByRole('textbox',{name:'手机号码',exact:true}).fill(otpTarget); await page4.getByRole('button',{name:'获取验证码',exact:true}).click();
      await page4.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor(); await page4.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+otpTarget)!);
      await page4.getByRole('button',{name:'验证并登录',exact:true}).click(); await page4.waitForURL('**/schedule'); expect(signedInUser).toBe(otpUser.userId);
      await closeContext(fourth);
      expect(bridgeFailures).toEqual([]);
      mark('COMPLETE');
    } catch(error) {
      let index=0;
      for(const context of browser.contexts()) for(const page of context.pages()) {
        await page.screenshot({path:path.join(screenshots,'m3-phone-bind-failure-'+index+'.png'),fullPage:true}).catch(()=>undefined);
        writeFileSync(path.join(screenshots,'m3-phone-bind-failure-'+index+'.txt'),await page.locator('body').innerText().catch(()=> 'Page unavailable')); index++;
      }
      throw error;
    } finally { for(const context of browser.contexts()) await closeContext(context); await browser.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
  },90000);
});
