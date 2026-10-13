import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { bootP2App, auth } from './p2-test-helpers';
import { AuthService } from '../src/auth/auth.service';
import { EmailBindingService } from '../src/auth/email-binding.service';
import { PasswordCredentialService } from '../src/auth/password-credential.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { RateLimiterService } from '../src/infrastructure/rate-limiter.service';
import { AuditService } from '../src/audit/audit.service';

describe.sequential('M2-02 safe new email binding on real SQL and Redis', () => {
  let app: INestApplication, pool: Pool, service: AuthService, binding: EmailBindingService, codes: LoginCodeService, redis: IORedis;
  const keys = ['SMS_LOGIN_SEND_ENABLED','SMS_LOGIN_TEMPLATE_ID','SMS_LOGIN_QUOTA_SECRET','AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_EMAIL_BIND_ENABLED','EMAIL_LOGIN_DELIVERY_ENDPOINT','SMS_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const deliveries = new Map<string,string>();
  const password = 'correct-horse-battery-staple';
  const email = () => 'bind-' + randomUUID() + '@example.test';
  let prefix: string;
  let budgetClock: {mockRestore:()=>void};
  beforeAll(async () => {
    process.env.AUTH_PASSWORD_CREDENTIAL_MODE = 'UNIFIED'; process.env.AUTH_EMAIL_BIND_ENABLED = 'true'; process.env.PUBLIC_REGISTRATION = 'true';
    process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT = process.env.SMS_LOGIN_DELIVERY_ENDPOINT = 'https://binding-delivery.fixture.test';
    process.env.LOGIN_CODE_DELIVERY_TOKEN = 'private-binding-fixture-token-that-is-longer-than-32';
    process.env.SMS_LOGIN_SEND_ENABLED='true';process.env.SMS_LOGIN_TEMPLATE_ID='fixture-login';process.env.SMS_LOGIN_QUOTA_SECRET='private-stable-sms-quota-fixture-key-xxxxxxxxxxxxxxxx';
    prefix = process.env.REDIS_KEY_PREFIX! + ':email-binding-tests';
    process.env.REDIS_KEY_PREFIX = process.env.TEST_REDIS_KEY_PREFIX = prefix;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (String(url) !== process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT) throw new Error('Unexpected outbound request');
      expect(options.redirect).toBe('error');
      const body = JSON.parse(String(options.body)); deliveries.set(body.purpose + ':' + body.recipient, body.code);
      return {ok:true,json:async()=>({accepted:true,requestId:body.requestId,providerRequestId:'fixture-sms',costFen:3})};
    }));
    ({app,pool} = await bootP2App('email-binding'));
    service = app.get(AuthService); binding = app.get(EmailBindingService); codes = app.get(LoginCodeService); redis = new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async () => {
    // Fixed-window assertions must not depend on the machine crossing an
    // arbitrary minute boundary. Redis TTLs and asynchronous timers stay real.
    budgetClock = vi.spyOn(Date,'now').mockReturnValue(Date.now());
    // Reset only this suite's random, isolated budgets between independent cases.
    await pool.execute('DELETE FROM auth_sms_attempts WHERE quota_namespace=?',[prefix]);await pool.execute('DELETE FROM auth_sms_quotas WHERE quota_namespace=?',[prefix]);
    const budgets = await redis.keys(prefix + ':ratelimit:*'); if (budgets.length) await redis.del(...budgets);
  });
  afterEach(() => budgetClock?.mockRestore());
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); await redis?.quit(); await pool?.end(); await app?.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });
  const post = (token: string, path: string, body: unknown) => request(app.getHttpServer()).post('/api/auth/email-binding/' + path).set(auth(token)).send(body);
  async function account() { const address = email(); return {...await service.register({email:address,password,displayName:'Binding fixture'}),email:address}; }
  async function noPassword(kind: 'email'|'phone' = 'email') {
    const address = kind === 'email' ? email() : '+86139' + String(Math.floor(Math.random()*100000000)).padStart(8,'0');
    return {...await service.loginVerified(kind,address,{}),email:address};
  }
  async function start(session: {accessToken:string}, target = email()) {
    const result = await post(session.accessToken,'start',{email:target,proof:'password',password}).expect(201);
    expect(result.body).toMatchObject({stage:'target',challengeExpiresIn:600});
    return {challenge:result.body.challenge as string,target};
  }
  async function targetCode(session:{accessToken:string}, grant:{challenge:string;target:string}) {
    await post(session.accessToken,'target/request',{challenge:grant.challenge}).expect(201);
    return deliveries.get('email-bind-target:' + grant.target)!;
  }
  async function methods(token: string) { return (await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(token)).expect(200)).body; }
  async function owner(address: string) {
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT BIN_TO_UUID(user_id) AS userId FROM login_identifiers WHERE kind='email' AND identifier=?",[address]);
    return rows[0]?.userId;
  }
  async function grantKey(challenge: string) { return (binding as any).key(challenge) as string; }
  async function releaseSendBudget() { await pool.execute("DELETE FROM auth_sms_quotas WHERE quota_namespace=? AND bucket='interval'",[prefix]); const budgets = await redis.keys(prefix + ':ratelimit:*'); if (budgets.length) await redis.del(...budgets); }

  it('password + new inbox proofs bind to the original user, OTP/password both enter the same data', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g);
    const [before] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,display_name FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
    expect(await owner(g.target)).toBe(s.userId);
    expect((await service.login({kind:'email',identifier:g.target,password},{})).userId).toBe(s.userId);
    await releaseSendBudget(); await codes.request({kind:'email',identifier:g.target},'binding-login');
    const logged = await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:g.target,code:deliveries.get('login:'+g.target)}).expect(201);
    expect(logged.body.userId).toBe(s.userId); expect(logged.body.firstLogin).toBe(false);
    const [after] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id,display_name FROM profiles WHERE user_id=UUID_TO_BIN(?)',[s.userId]); expect(after).toEqual(before);
    expect((await service.login({email:s.email,password},{})).userId).toBe(s.userId);
  });
  it.each(['email','phone'] as const)('a password-free %s user verifies its existing channel and binds an email without creating a password', async kind => {
    const s = await noPassword(kind), m = await methods(s.accessToken), target = email();
    expect(m.passwordConfigured).toBe(false);
    const result = await post(s.accessToken,'start',{email:target,proof:'code',identifierId:m.emailBinding.sources[0].id}).expect(201), challenge = result.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('email-bind-current:'+s.email)}).expect(201);
    const code = await targetCode(s,{challenge,target}); await post(s.accessToken,'confirm',{challenge,code}).expect(201);
    expect(await owner(target)).toBe(s.userId); expect((await methods(s.accessToken)).passwordConfigured).toBe(false);
  });
  it('does not offer an unverified legacy inbox as current-account OTP proof', async () => {
    const s = await account(), m = await methods(s.accessToken);
    expect(m.emailBinding.sources).toEqual([]);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS id FROM auth_identities WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'start',{email:email(),proof:'code',identifierId:rows[0].id}).expect(401);
  });
  it('cannot select a source owned by another user or a client-supplied user/session/target', async () => {
    const s = await account(), other = await noPassword(), m = await methods(other.accessToken);
    await post(s.accessToken,'start',{email:email(),proof:'code',identifierId:m.emailBinding.sources[0].id}).expect(401);
    for (const extra of [{userId:other.userId},{sessionId:randomUUID()}]) await post(s.accessToken,'start',{email:email(),proof:'password',password,...extra}).expect(400);
    const g = await start(s); await post(s.accessToken,'target/request',{challenge:g.challenge,email:email()}).expect(400);
  });
  it('requires exactly one current-account proof and refuses a wrong password before delivery', async () => {
    const s = await account(), fetch = vi.mocked(globalThis.fetch), before = fetch.mock.calls.length;
    await post(s.accessToken,'start',{email:email(),proof:'password',password:'wrong-password'}).expect(401);
    await post(s.accessToken,'start',{email:email(),proof:'password',password,identifierId:randomUUID()}).expect(400);
    await post(s.accessToken,'start',{email:email(),proof:'code',identifierId:randomUUID(),password}).expect(400);
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
    const result = await post(refreshed.accessToken,'target/request',{challenge:g.challenge}).expect(401); expect(result.body.code).toBe('EMAIL_BIND_PROOF_EXPIRED');
    expect(await owner(g.target)).toBeUndefined();
  });
  it.each(['logout','disabled','expired-session'] as const)('%s prevents a guarded write even with a previously validated server context', async action => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), user = await service.verifyToken(s.accessToken);
    if (action === 'logout') await service.logout(s.refreshToken);
    if (action === 'disabled') await pool.execute("UPDATE users SET status='disabled' WHERE id=UUID_TO_BIN(?)",[s.userId]);
    if (action === 'expired-session') await pool.execute('UPDATE auth_sessions SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE),expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE id=UUID_TO_BIN(?)',[user.sessionId]);
    await expect(binding.confirm(user,g.challenge,code,'guarded-'+action)).rejects.toMatchObject({response:{code:'EMAIL_BIND_PROOF_EXPIRED'}});
    await request(app.getHttpServer()).get('/api/auth/security/methods').set(auth(s.accessToken)).expect(401);
    expect(await owner(g.target)).toBeUndefined();
  });
  it('a credential version change invalidates proofs even when its hash remains the same', async () => {
    const s = await account(), g = await start(s);
    await pool.execute('UPDATE password_credentials SET version=version+1 WHERE user_id=UUID_TO_BIN(?)',[s.userId]);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(401);
  });
  it('adding the first password invalidates a password-free binding proof', async () => {
    const s = await noPassword(), m = await methods(s.accessToken), target = email();
    const result = await post(s.accessToken,'start',{email:target,proof:'code',identifierId:m.emailBinding.sources[0].id}).expect(201), challenge = result.body.challenge;
    await post(s.accessToken,'current/confirm',{challenge,code:deliveries.get('email-bind-current:'+s.email)}).expect(201);
    await service.setInitialPassword(s.userId,s.email,password);
    await post(s.accessToken,'target/request',{challenge}).expect(401);
  });
  it('revoking or changing source ownership invalidates OTP proof', async () => {
    const s = await noPassword(), other = await account(), m = await methods(s.accessToken), id = m.emailBinding.sources[0].id;
    const r = await post(s.accessToken,'start',{email:email(),proof:'code',identifierId:id}).expect(201);
    await pool.execute('UPDATE login_identifiers SET user_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)',[other.userId,id]);
    await post(s.accessToken,'current/confirm',{challenge:r.body.challenge,code:deliveries.get('email-bind-current:'+s.email)}).expect(401);
  });
  it('expired and replayed grants fail closed; one success produces one audit', async () => {
    const s = await account(), expired = await start(s);
    const key = await grantKey(expired.challenge), state = JSON.parse((await redis.get(key))!); state.expiresAt = Date.now()-1; await redis.set(key,JSON.stringify(state),'EX',60);
    await post(s.accessToken,'target/request',{challenge:expired.challenge}).expect(401);
    const g = await start(s), code = await targetCode(s,g); await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(201);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
    const [logs] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_EMAIL_BOUND'",[s.userId]); expect(Number(logs[0].n)).toBe(1);
  });
  it('login, current-account, target and another challenge codes are isolated', async () => {
    const s = await noPassword(), m = await methods(s.accessToken), target = email();
    const r = await post(s.accessToken,'start',{email:target,proof:'code',identifierId:m.emailBinding.sources[0].id}).expect(201), challenge = r.body.challenge, current = deliveries.get('email-bind-current:'+s.email)!;
    await post(s.accessToken,'target/request',{challenge}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:s.email,code:current}).expect(401);
    await post(s.accessToken,'current/confirm',{challenge,code:current}).expect(201);
    await post(s.accessToken,'confirm',{challenge,code:current}).expect(401); // No target code exists.
    const s2 = await account(), g2 = await start(s2,target), targetOtp = await targetCode(s2,g2);
    await post(s.accessToken,'confirm',{challenge,code:targetOtp}).expect(401); // Another context, same target.
    await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'email',identifier:target,code:targetOtp}).expect(401);
    expect(await owner(target)).toBeUndefined();
  });
  it('wrong target OTP attempts exhaust a bounded budget', async () => {
    const s = await account(), g = await start(s);
    const actual = await targetCode(s,g), wrong = actual === '999999' ? '888888' : '999999';
    for (let n=0;n<5;n++) await post(s.accessToken,'confirm',{challenge:g.challenge,code:wrong}).expect(401);
    await post(s.accessToken,'confirm',{challenge:g.challenge,code:actual}).expect(429);
  });
  it('wrong existing-channel codes have a bounded budget and cannot promote the grant', async () => {
    const s = await noPassword(), m = await methods(s.accessToken);
    const r = await post(s.accessToken,'start',{email:email(),proof:'code',identifierId:m.emailBinding.sources[0].id}).expect(201), challenge = r.body.challenge;
    const wrong = deliveries.get('email-bind-current:'+s.email) === '999999' ? '888888' : '999999';
    for(let n=0;n<5;n++) await post(s.accessToken,'current/confirm',{challenge,code:wrong}).expect(401);
    await post(s.accessToken,'current/confirm',{challenge,code:wrong}).expect(429);
    await post(s.accessToken,'target/request',{challenge}).expect(401);
  });
  it('current-password attempts share a user budget across target addresses', async () => {
    const s = await account();
    for(let n=0;n<10;n++) await post(s.accessToken,'start',{email:email(),proof:'password',password:'wrong-password'}).expect(401);
    await post(s.accessToken,'start',{email:email(),proof:'password',password}).expect(429);
  });
  it('identifier send budgets are shared across login and binding purposes', async () => {
    const s = await account(), g = await start(s); await targetCode(s,g);
    await request(app.getHttpServer()).post('/api/auth/code/request').send({kind:'email',identifier:g.target}).expect(429);
    await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(429);
  });
  it('an occupied legacy or verified mailbox is never transferred or merged', async () => {
    const s = await account(), legacy = await account(), known = await noPassword();
    for (const target of [legacy.email,known.email]) await post(s.accessToken,'start',{email:target,proof:'password',password}).expect(409);
    expect(await owner(known.email)).toBe(known.userId);
    expect((await service.login({email:legacy.email,password},{})).userId).toBe(legacy.userId);
  });
  it('parallel users cannot both bind one target', async () => {
    const a = await account(), b = await account(), target = email(), ga = await start(a,target), gb = await start(b,target);
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
    const results = await Promise.allSettled([binding.confirm(await service.verifyToken(s.accessToken),g.challenge,code,'anonymous-race'),service.loginVerified('email',g.target,{})]);
    const winner = await owner(g.target); expect(winner).toBeTruthy();
    if (results[0].status === 'fulfilled') expect(winner).toBe(s.userId);
    else expect(results[0].reason).toMatchObject({response:{code:'EMAIL_BIND_OCCUPIED'}});
    expect(results[1].status).toBe('fulfilled'); if (results[1].status === 'fulfilled') expect(results[1].value.userId).toBe(winner);
  });
  it('audit failure rolls back identifier and audit, consumes proofs and requires a fresh workflow', async () => {
    const s = await account(), g = await start(s), code = await targetCode(s,g), audit = app.get(AuditService), append = audit.append.bind(audit);
    const spy = vi.spyOn(audit,'append').mockImplementation(async(entry,tx)=>{ if(entry.action==='LOGIN_EMAIL_BOUND') throw new Error('private-audit-fixture'); return append(entry,tx); });
    try { const r = await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(503); expect(JSON.stringify(r.body)).not.toContain('private-audit-fixture'); } finally { spy.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined(); await post(s.accessToken,'confirm',{challenge:g.challenge,code}).expect(401);
    const [logs] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action='LOGIN_EMAIL_BOUND'",[s.userId]); expect(Number(logs[0].n)).toBe(0);
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
    await request(app.getHttpServer()).post('/api/auth/email-binding/start').send({email:email(),proof:'password',password}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/email-binding/confirm').send({challenge:'a'.repeat(64),code:'123456'}).expect(401);
  });
  it('the rollout flag hides the entry and rejects new binding while retaining existing login', async () => {
    const s = await account(), config = (binding as any).config, get = config.get.bind(config);
    const spy = vi.spyOn(config,'get').mockImplementation((...args:any[])=>args[0]==='AUTH_EMAIL_BIND_ENABLED'?'false':get(...args));
    try {
      expect((await methods(s.accessToken)).emailBinding).toEqual({available:false,sources:[]});
      await post(s.accessToken,'start',{email:email(),proof:'password',password}).expect(403);
      expect((await service.login({email:s.email,password},{})).userId).toBe(s.userId);
    } finally { spy.mockRestore(); }
  });
  it('Redis or limiter failures cannot deliver target codes or write identifiers', async () => {
    const s = await account(), g = await start(s), client = (binding as any).redis as IORedis;
    const spy = vi.spyOn(client,'get').mockRejectedValue(new Error('private-redis-outage'));
    try { const r = await post(s.accessToken,'target/request',{challenge:g.challenge}).expect(503); expect(JSON.stringify(r.body)).not.toContain('private-redis-outage'); } finally { spy.mockRestore(); }
    const limiter = vi.spyOn(app.get(RateLimiterService),'consume').mockRejectedValue(new Error('private-limiter-outage'));
    try { await post(s.accessToken,'start',{email:email(),proof:'password',password}).expect(503); } finally { limiter.mockRestore(); }
    expect(await owner(g.target)).toBeUndefined();
  });
  it('HTTP and Redis expose neither password hashes nor OTPs nor the raw grant in a key', async () => {
    const s = await account(), g = await start(s), key = await grantKey(g.challenge), raw = (await redis.get(key))!;
    expect(key).not.toContain(g.challenge); expect(raw).not.toContain(password); expect(raw).not.toContain('$2'); expect(raw).not.toContain(g.challenge);
    await targetCode(s,g); const m = await methods(s.accessToken);
    expect(JSON.stringify(m)).not.toMatch(/passwordHash|passwordEpoch|sourceLegacyIdentityId|credentialId/); expect(JSON.parse(raw)).not.toHaveProperty('code');
  });

  it('consumes a deployed M2 email grant and OTP without changing its stored format or namespace', async () => {
    const s = await account(), user = await service.verifyToken(s.accessToken), target = email(), challenge = randomBytes(32).toString('hex');
    // This is the persisted M2-02 wire contract, independent of the new engine.
    const digest = (value:string) => createHmac('sha256',process.env.JWT_SECRET!).update('email-binding:'+value).digest('hex');
    const passwordEpoch = digest(JSON.stringify(await app.get(PasswordCredentialService).observe(s.userId)));
    const oldState = {userId:s.userId,sessionId:user.sessionId,email:target,passwordEpoch,stage:'target',expiresAt:Date.now()+600000};
    await redis.set(prefix+':email-binding:'+digest(challenge),JSON.stringify(oldState),'EX',600);
    await codes.request({kind:'email',identifier:target},'old-email-contract',{purpose:'email-bind-target',userId:s.userId,context:digest(JSON.stringify([challenge,user.sessionId,target,passwordEpoch,undefined]))});
    await post(s.accessToken,'confirm',{challenge,code:deliveries.get('email-bind-target:'+target)}).expect(201);
    expect(await owner(target)).toBe(s.userId);
  });

  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome password and password-free binding preserve the original account on new-email login', async () => {
    const s = await account(), target = email();
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
    const mark = (phase:string) => writeFileSync(path.join(screenshots,'m2-bind-browser-phase.json'),JSON.stringify({phase,at:new Date().toISOString()}));
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
      await page.getByRole('button',{name:/添加登录邮箱/}).click(); await page.getByLabel('新邮箱',{exact:true}).fill(target); await page.getByLabel('当前密码',{exact:true}).fill(password);
      await page.screenshot({path:path.join(screenshots,'m2-bind-current.png'),fullPage:true});
      await page.getByRole('button',{name:'验证当前账号',exact:true}).click();
      await page.getByRole('button',{name:'获取新邮箱验证码',exact:true}).click(); await page.getByText('验证码已发送，5 分钟内有效。',{exact:true}).waitFor();
      await page.getByLabel('新邮箱验证码',{exact:true}).fill(deliveries.get('email-bind-target:'+target)!);
      await page.screenshot({path:path.join(screenshots,'m2-bind-target.png'),fullPage:true});
      await page.getByRole('button',{name:'验证并绑定邮箱',exact:true}).click(); await page.getByRole('button',{name:'返回账号与验证',exact:true}).waitFor();
      await page.screenshot({path:path.join(screenshots,'m2-bind-success.png'),fullPage:true}); expect(await owner(target)).toBe(s.userId);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      mark('PASSWORD_BOUND');
      await closeContext(context); const second = await browser.newContext(), page2 = await second.newPage();
      page2.setDefaultTimeout(15000);
      await page2.route('http://127.0.0.1:3001/api/**',bridge);
      await page2.goto(origin+'/auth/password-login'); await page2.getByLabel('邮箱账号',{exact:true}).fill(target); await page2.getByLabel('密码',{exact:true}).fill(password);
      await page2.getByRole('button',{name:'登录',exact:true}).click(); await page2.waitForURL('**/schedule'); expect(signedInUser).toBe(s.userId); await closeContext(second);
      mark('PASSWORD_ALIAS_LOGIN_COMPLETE');
      // The password-optional path is exercised through the same real UI/API.
      const otpUser = await noPassword(), otpTarget = email(), third = await browser.newContext({viewport:{width:390,height:844}}), page3 = await third.newPage();
      page3.setDefaultTimeout(15000);
      await page3.route('http://127.0.0.1:3001/api/**',bridge);
      await page3.goto(origin+'/auth/login'); await page3.getByRole('textbox',{name:'邮箱',exact:true}).fill(otpUser.email);
      mark('OTP_LOGIN_SEND');
      await page3.getByRole('button',{name:'获取验证码',exact:true}).click(); await page3.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor();
      await page3.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+otpUser.email)!); await page3.getByRole('button',{name:'验证并登录',exact:true}).click(); await page3.waitForURL('**/schedule'); expect(signedInUser).toBe(otpUser.userId);
      mark('OTP_ORIGINAL_LOGIN_COMPLETE');
      await page3.getByRole('button',{name:'我的',exact:true}).first().click(); await page3.getByRole('button',{name:/账号与登录/}).click(); await page3.getByRole('button',{name:/添加登录邮箱/}).click();
      await page3.getByLabel('新邮箱',{exact:true}).fill(otpTarget); await page3.getByRole('button',{name:'发送当前账号验证码',exact:true}).waitFor();
      mark('OTP_CURRENT_SEND');
      await releaseSendBudget(); await page3.getByRole('button',{name:'发送当前账号验证码',exact:true}).click(); await page3.getByLabel('当前账号验证码',{exact:true}).waitFor();
      await page3.getByLabel('当前账号验证码',{exact:true}).fill(deliveries.get('email-bind-current:'+otpUser.email)!);
      await page3.screenshot({path:path.join(screenshots,'m2-bind-password-free-current.png'),fullPage:true});
      await page3.getByRole('button',{name:'确认当前账号',exact:true}).click(); await page3.getByRole('button',{name:'获取新邮箱验证码',exact:true}).click(); await page3.getByText('验证码已发送，5 分钟内有效。',{exact:true}).waitFor();
      mark('OTP_TARGET_SENT');
      await page3.getByLabel('新邮箱验证码',{exact:true}).fill(deliveries.get('email-bind-target:'+otpTarget)!); await page3.getByRole('button',{name:'验证并绑定邮箱',exact:true}).click();
      await page3.getByRole('button',{name:'返回账号与验证',exact:true}).waitFor(); expect(await owner(otpTarget)).toBe(otpUser.userId);
      mark('OTP_EMAIL_BOUND');
      await page3.screenshot({path:path.join(screenshots,'m2-bind-password-free-success.png'),fullPage:true}); expect(await page3.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page3.getByRole('button',{name:'返回账号与验证',exact:true}).click(); await page3.getByText('可选设置，也可继续使用验证码',{exact:true}).filter({visible:true}).first().waitFor();
      await page3.screenshot({path:path.join(screenshots,'m2-bind-password-free-security.png'),fullPage:true});
      await closeContext(third);
      const fourth = await browser.newContext(), page4 = await fourth.newPage(); await page4.route('http://127.0.0.1:3001/api/**',bridge);
      page4.setDefaultTimeout(15000);
      await releaseSendBudget(); await page4.goto(origin+'/auth/login'); await page4.getByRole('textbox',{name:'邮箱',exact:true}).fill(otpTarget); await page4.getByRole('button',{name:'获取验证码',exact:true}).click();
      await page4.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor(); await page4.getByLabel('验证码',{exact:true}).fill(deliveries.get('login:'+otpTarget)!);
      await page4.getByRole('button',{name:'验证并登录',exact:true}).click(); await page4.waitForURL('**/schedule'); expect(signedInUser).toBe(otpUser.userId);
      await closeContext(fourth);
      expect(bridgeFailures).toEqual([]);
      mark('COMPLETE');
    } catch(error) {
      let index=0;
      for(const context of browser.contexts()) for(const page of context.pages()) {
        await page.screenshot({path:path.join(screenshots,'m2-bind-failure-'+index+'.png'),fullPage:true}).catch(()=>undefined);
        writeFileSync(path.join(screenshots,'m2-bind-failure-'+index+'.txt'),await page.locator('body').innerText().catch(()=> 'Page unavailable')); index++;
      }
      throw error;
    } finally { for(const context of browser.contexts()) await closeContext(context); await browser.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
  },90000);
});
