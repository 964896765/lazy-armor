import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import type { Pool,RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { beforeAll,afterAll,beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { bootP2App,auth } from './p2-test-helpers';
import { SmsAbuseService } from '../src/auth/sms-abuse.service';
import { AuthService } from '../src/auth/auth.service';
import { DATABASE } from '../src/common/database.module';
import { withSmsRequestHints } from '../src/auth/sms-request-context';

describe.sequential('M3-04 durable SMS request anomaly limits',()=>{
 let app:INestApplication,pool:Pool,redis:IORedis,risk:SmsAbuseService,prefix:string;
 const keys=['AUTH_SMS_ABUSE_GUARD_ENABLED','AUTH_SMS_ABUSE_SECRET','AUTH_SMS_RISK_CLEANUP_ENABLED','AUTH_SMS_CLIENT_SEND_LIMIT','AUTH_SMS_CLIENT_PHONE_LIMIT','AUTH_SMS_IP_PHONE_LIMIT','AUTH_SMS_CLIENT_IP_LIMIT','AUTH_SMS_CLIENT_AGENT_LIMIT','AUTH_SMS_RISK_DAILY_REQUEST_LIMIT','AUTH_SMS_RISK_RETENTION_DAYS','SMS_LOGIN_SEND_ENABLED','SMS_LOGIN_TEMPLATE_ID','SMS_LOGIN_QUOTA_SECRET','AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_PHONE_BIND_ENABLED','AUTH_EMAIL_BIND_ENABLED','EMAIL_LOGIN_DELIVERY_ENDPOINT','SMS_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','PUBLIC_REGISTRATION','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX'] as const;
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const delivered:Array<Record<string,any>>=[];
 const phone=()=>'+86139'+String(Math.floor(Math.random()*100000000)).padStart(8,'0');
 const marker=()=> 'client-'+randomUUID();
 beforeAll(async()=>{
  Object.assign(process.env,{AUTH_SMS_ABUSE_GUARD_ENABLED:'true',AUTH_SMS_ABUSE_SECRET:'independent-sms-risk-fixture-secret-xxxxxxxxxxx',SMS_LOGIN_SEND_ENABLED:'true',SMS_LOGIN_TEMPLATE_ID:'fixture-login',SMS_LOGIN_QUOTA_SECRET:'independent-sms-quota-fixture-secret-xxxxxxxxx',AUTH_PASSWORD_CREDENTIAL_MODE:'UNIFIED',AUTH_PHONE_BIND_ENABLED:'true',AUTH_EMAIL_BIND_ENABLED:'true',EMAIL_LOGIN_DELIVERY_ENDPOINT:'https://sms-risk.fixture.test',SMS_LOGIN_DELIVERY_ENDPOINT:'https://sms-risk.fixture.test',LOGIN_CODE_DELIVERY_TOKEN:'independent-sms-gateway-fixture-secret-xxxxxxxx',PUBLIC_REGISTRATION:'true'});
  prefix=process.env.REDIS_KEY_PREFIX!+':sms-risk';process.env.REDIS_KEY_PREFIX=process.env.TEST_REDIS_KEY_PREFIX=prefix;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{if(String(url)!==process.env.SMS_LOGIN_DELIVERY_ENDPOINT)throw new Error('Unexpected outbound request');const body=JSON.parse(String(options.body));delivered.push(body);return {ok:true,json:async()=>({accepted:true,requestId:body.requestId,providerRequestId:'fixture-risk',costFen:3})};}));
  ({app,pool}=await bootP2App('sms-risk'));risk=app.get(SmsAbuseService);redis=new IORedis(process.env.REDIS_URL!);
 });
 beforeEach(async()=>{
  delivered.length=0;
  for(const table of ['auth_sms_risk_events','auth_sms_risk_subjects','auth_sms_attempts','auth_sms_quotas'])await pool.execute('DELETE FROM '+table+' WHERE quota_namespace=?',[prefix]);
  const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
 });
 afterEach(()=>vi.restoreAllMocks());
 afterAll(async()=>{vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
 const send=(number:string,client:string|null=marker(),agent='Fixture Browser')=>{const test=request(app.getHttpServer()).post('/api/auth/code/request').set('user-agent',agent).send({kind:'phone',identifier:number});return client?test.set('x-auth-client-id',client):test;};
 const records=async(table:string)=>(await pool.execute<RowDataPacket[]>('SELECT * FROM '+table+' WHERE quota_namespace=? ORDER BY created_at,id',[prefix]))[0];
 const override=(key:string,value:unknown)=>{const config=app.get(ConfigService),get=config.get.bind(config);return vi.spyOn(config,'get').mockImplementation((name:string,...rest:any[])=>name===key?value:get(name,...rest));};
 async function check(client:string,number=phone(),ip='192.0.2.10',agent='Fixture Browser',purpose='login'){return withSmsRequestHints({clientId:client,userAgent:agent},()=>risk.check(number,ip,purpose));}

 it('rejects missing/malformed hints and arbitrary body device authority before fee reservation or OTP',async()=>{
  for(const client of [null,'short','client.bad.header'])await send(phone(),client).expect(400);
  await request(app.getHttpServer()).post('/api/auth/code/request').set('x-auth-client-id',marker()).send({kind:'phone',identifier:phone(),clientId:marker(),trustedDeviceId:randomUUID()}).expect(400);
  expect(delivered).toHaveLength(0);expect(await records('auth_sms_attempts')).toHaveLength(0);expect(await records('auth_sms_risk_events')).toHaveLength(0);
 });
 it('allows a normal protected request without creating a user or granting a trusted-device principal',async()=>{
  const [before]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM users');await send(phone()).expect(201);const [after]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM users');expect(after).toEqual(before);
  const methods=await request(app.getHttpServer()).get('/api/auth/methods').expect(200);expect(methods.body.smsRequestProtection).toEqual({enabled:true,clientMarkerRequired:true,retentionDays:7});
  expect((await records('auth_sms_risk_events'))[0]).toMatchObject({decision:'ALLOW',reason:'ALLOW'});expect(await records('auth_sms_attempts')).toHaveLength(1);
 });
 it('blocks client phone fanout before sending the fourth number and retains committed evidence',async()=>{
  const client=marker();for(let i=0;i<3;i++)await send(phone(),client).expect(201);
  const result=await send(phone(),client).expect(429);expect(result.body).toMatchObject({code:'SMS_RISK_BLOCKED',retryAfterMs:expect.any(Number)});expect(result.body.retryAfterMs).toBeGreaterThan(590000);
  expect(delivered).toHaveLength(3);expect(await records('auth_sms_attempts')).toHaveLength(3);expect((await records('auth_sms_risk_events')).at(-1)).toMatchObject({decision:'BLOCK',reason:'CLIENT_PHONES'});
 });
 it('new markers and spoofed forwarding headers do not reset the server IP fanout',async()=>{
  const spy=override('AUTH_SMS_IP_PHONE_LIMIT',2);
  try{for(let i=0;i<2;i++)await send(phone(),marker()).set('x-forwarded-for','192.0.2.'+(10+i)).expect(201);await send(phone(),marker()).set('x-forwarded-for','198.51.100.20').expect(429);}finally{spy.mockRestore();}
  const rows=await records('auth_sms_risk_events');expect(new Set(rows.map(row=>row.ip_key)).size).toBe(1);expect(rows.at(-1)).toMatchObject({reason:'IP_PHONES'});expect(delivered).toHaveLength(2);
 });
 it('repeated attempts during a number cooldown count toward client risk without extra charges',async()=>{
  const client=marker(),number=phone();await send(number,client).expect(201);for(let i=0;i<4;i++)await send(number,client).expect(429);
  const sixth=await send(number,client).expect(429);expect(sixth.body.code).toBe('SMS_RISK_BLOCKED');expect((await records('auth_sms_risk_events')).at(-1)).toMatchObject({reason:'CLIENT_SEND'});expect(await records('auth_sms_attempts')).toHaveLength(1);
 });
 it.each(['ip','agent'] as const)('detects rapid %s variations of one untrusted client marker',async kind=>{
  const client=marker(),number=phone();for(let i=0;i<2;i++)await check(client,number,kind==='ip'?'192.0.2.'+(10+i):'192.0.2.10',kind==='agent'?'Browser '+i:'Browser');
  await expect(check(client,number,kind==='ip'?'192.0.2.12':'192.0.2.10',kind==='agent'?'Browser 2':'Browser')).rejects.toMatchObject({response:{code:'SMS_RISK_BLOCKED'}});
  expect((await records('auth_sms_risk_events')).at(-1)?.reason).toBe(kind==='ip'?'CLIENT_IPS':'CLIENT_AGENTS');expect(delivered).toHaveLength(0);
 });
 it('concurrent requests with a client limit of one have one winner and no over-budget SMS',async()=>{
  const spy=override('AUTH_SMS_CLIENT_SEND_LIMIT',1),client=marker();try{const result=await Promise.all([send(phone(),client),send(phone(),client)]);expect(result.map(item=>item.status).sort()).toEqual([201,429]);expect(await records('auth_sms_attempts')).toHaveLength(1);}finally{spy.mockRestore();}
 });
 it('concurrent request middleware keeps each caller hint isolated across awaits',async()=>{
  const a=marker(),b=marker(),pa=phone(),pb=phone();await Promise.all([send(pa,a,'Agent A').expect(201),send(pb,b,'Agent B').expect(201)]);
  const rows=await records('auth_sms_risk_events'),digest=(risk as any).digest.bind(risk);expect(rows.find(row=>row.phone_key===digest('phone',pa))?.client_key).toBe(digest('client',a));expect(rows.find(row=>row.phone_key===digest('phone',pb))?.client_key).toBe(digest('client',b));
 });
 it('changing application clocks cannot reset durable windows or their blocks',async()=>{
  const client=marker(),number=phone(),limit=override('AUTH_SMS_CLIENT_SEND_LIMIT',1);try{await check(client,number);const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+86400000*100);await expect(check(client,phone())).rejects.toMatchObject({response:{code:'SMS_RISK_BLOCKED'}});clock.mockRestore();}finally{limit.mockRestore();}
 });
 it('equivalent IPv6/mapped IPv4 addresses share the same server IP admission',async()=>{
  const client=marker(),number=phone();await check(client,number,'192.0.2.10');await check(client,number,'::ffff:c000:020a');await check(client,number,'::FFFF:192.0.2.10');const rows=await records('auth_sms_risk_events');expect(new Set(rows.map(row=>row.ip_key)).size).toBe(1);
 });
 it('independent SMS stop preserves email fallback without disabling the risk/cleanup service',async()=>{
  const spy=override('SMS_LOGIN_SEND_ENABLED','false');try{await send(phone()).expect(503);const methods=await request(app.getHttpServer()).get('/api/auth/methods').expect(200);expect(methods.body.codeLogin.phone).toBe('UNAVAILABLE');expect(methods.body.smsRequestProtection.enabled).toBe(true);await request(app.getHttpServer()).post('/api/auth/code/request').send({kind:'email',identifier:'risk-stop-'+randomUUID()+'@example.test'}).expect(201);expect(delivered).toHaveLength(1);expect(delivered[0].channel).toBe('email');}finally{spy.mockRestore();}
 });
 it('an active block is not prolonged by requests and expired blocks start a fresh window',async()=>{
  const client=marker(),number=phone(),limit=override('AUTH_SMS_CLIENT_SEND_LIMIT',1);await check(client,number);await expect(check(client,number)).rejects.toMatchObject({status:429});const blocked=(await records('auth_sms_risk_subjects')).find(row=>row.kind==='client')!.blocked_until;
  await expect(check(client,number)).rejects.toMatchObject({status:429});expect((await records('auth_sms_risk_subjects')).find(row=>row.kind==='client')!.blocked_until).toEqual(blocked);
  const clock=vi.spyOn(risk as any,'clock').mockResolvedValue(blocked.getTime()+1);try{await check(client,number);const row=(await records('auth_sms_risk_subjects')).find(row=>row.kind==='client')!;expect(row.request_count).toBe(1);expect(row.blocked_until).toBeNull();}finally{clock.mockRestore();limit.mockRestore();}
 });
 it('durable daily admission bounds record growth even after clearing Redis or rebuilding the service',async()=>{
  const spy=override('AUTH_SMS_RISK_DAILY_REQUEST_LIMIT',1);try{await check(marker());const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);const rebuilt=new SmsAbuseService(app.get(DATABASE),app.get(ConfigService),app.get((await import('../src/infrastructure/rate-limiter.service')).RateLimiterService));await rebuilt.onModuleInit();try{await expect(withSmsRequestHints({clientId:marker()},()=>rebuilt.check(phone(),'198.51.100.10','login'))).rejects.toMatchObject({status:429});}finally{await rebuilt.onApplicationShutdown();}expect(await records('auth_sms_risk_subjects')).toHaveLength(3);expect(await records('auth_sms_risk_events')).toHaveLength(1);}finally{spy.mockRestore();}
 });
 it('waiting across China midnight rolls back the old daily bucket and recalculates admission',async()=>{
  const old=Date.parse('2026-10-14T15:59:59Z'),next=Date.parse('2026-10-14T16:00:00Z'),spy=vi.spyOn(risk as any,'clock').mockResolvedValueOnce(old).mockResolvedValue(next);try{await check(marker());const rows=await records('auth_sms_risk_subjects');expect(rows.filter(row=>row.kind==='day')).toHaveLength(1);expect(rows.find(row=>row.kind==='day')?.subject_key).toBe((risk as any).digest('day','2026-10-15'));}finally{spy.mockRestore();}
 });
 it('transaction failure rolls back all risk counters/events and never reserves SMS fees',async()=>{
  const db=app.get(DATABASE),transaction=db.transaction.bind(db);const spy=vi.spyOn(db,'transaction').mockImplementation((work,options)=>transaction(async tx=>{const value=await work(tx);throw new Error('fixture failure after risk event');return value;},options));
  try{const result=await send(phone()).expect(503);expect(result.body.code).toBe('SMS_RISK_SERVICE_UNAVAILABLE');expect(JSON.stringify(result.body)).not.toContain('fixture');}finally{spy.mockRestore();}
  expect(await records('auth_sms_risk_subjects')).toHaveLength(0);expect(await records('auth_sms_risk_events')).toHaveLength(0);expect(await records('auth_sms_attempts')).toHaveLength(0);expect(delivered).toHaveLength(0);
 });
 it('a real SQL lock exceeds the deadline without dispatching; a late risk decision remains conservative',async()=>{
  await check(marker());const connection=await pool.getConnection();await connection.beginTransaction();await connection.execute("SELECT id FROM auth_sms_risk_subjects WHERE quota_namespace=? AND kind='day' FOR UPDATE",[prefix]);
  const started=performance.now();try{const result=await send(phone()).expect(503);expect(result.body.code).toBe('SMS_RISK_SERVICE_UNAVAILABLE');expect(performance.now()-started).toBeLessThan(4000);expect(delivered).toHaveLength(0);}finally{await connection.rollback();connection.release();}
  await new Promise(resolve=>setTimeout(resolve,100));expect(await records('auth_sms_attempts')).toHaveLength(0);
 },10000);
 it('risk records contain keyed pseudonyms rather than phone/IP/client/agent or account secrets',async()=>{
  const client=marker(),number=phone(),agent='private-fixture-user-agent';await send(number,client,agent).expect(201);const text=JSON.stringify([await records('auth_sms_risk_subjects'),await records('auth_sms_risk_events')]);for(const value of [client,number,agent,'127.0.0.1'])expect(text).not.toContain(value);
 });
 it('cleanup removes only expired records in this namespace, preserving active blocks and another environment',async()=>{
  await check(marker());await pool.execute('UPDATE auth_sms_risk_subjects SET updated_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 8 DAY) WHERE quota_namespace=? AND kind=\'day\'',[prefix]);await pool.execute('UPDATE auth_sms_risk_events SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 8 DAY) WHERE quota_namespace=?',[prefix]);
  await pool.execute("INSERT INTO auth_sms_risk_events(id,quota_namespace,client_key,ip_key,phone_key,purpose,decision,reason,created_at) VALUES(UUID_TO_BIN(?),?,?,?,?,'login','ALLOW','ALLOW',DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 8 DAY))",[randomUUID(),prefix+':other','a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]);
  await risk.cleanup();expect(await records('auth_sms_risk_events')).toHaveLength(0);expect((await records('auth_sms_risk_subjects')).some(row=>row.kind==='client')).toBe(true);const [other]=await pool.execute<RowDataPacket[]>('SELECT id FROM auth_sms_risk_events WHERE quota_namespace=?',[prefix+':other']);expect(other).toHaveLength(1);
 });
 it('turning protection off retains issued OTP and allows email while cleanup can remain active',async()=>{
  const number=phone(),client=marker();await send(number,client).expect(201);const code=delivered[0].code,spy=override('AUTH_SMS_ABUSE_GUARD_ENABLED','false');try{const result=await request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'phone',identifier:number,code}).expect(201);expect(result.body.userId).toBeTruthy();await send(phone(),null).expect(201);const rows=await records('auth_sms_risk_events');expect(rows).toHaveLength(1);await risk.cleanup();}finally{spy.mockRestore();}
 });
 it('authenticated phone binding uses the same request risk admission as anonymous login',async()=>{
  const service=app.get(AuthService),s=await service.register({email:'risk-bind-'+randomUUID()+'@example.test',password:'correct-horse-battery-staple',displayName:'Risk binding fixture'}),client=marker();
  const start=await request(app.getHttpServer()).post('/api/auth/phone-binding/start').set(auth(s.accessToken)).set('x-auth-client-id',client).send({phone:phone(),proof:'password',password:'correct-horse-battery-staple'}).expect(201);
  const limit=override('AUTH_SMS_CLIENT_SEND_LIMIT',1);try{await check(client);const result=await request(app.getHttpServer()).post('/api/auth/phone-binding/target/request').set(auth(s.accessToken)).set('x-auth-client-id',client).send({challenge:start.body.challenge}).expect(429);expect(result.body.code).toBe('SMS_RISK_BLOCKED');expect(delivered).toHaveLength(0);}finally{limit.mockRestore();}
 });
 it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome shows risk cooldown and bound-email fallback enters the original account',async()=>{
  const service=app.get(AuthService),address='risk-browser-'+randomUUID()+'@example.test',number=phone(),s=await service.loginVerified('email',address,{});
  await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'phone',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),s.userId,number]);
  const {chromium}=await import('playwright-core'),{createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path');const dist=path.resolve(process.cwd(),'../mobile/dist'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();const server=createServer((req,res)=>{const requested=path.resolve(dist,'.'+new URL(req.url!,'http://localhost').pathname),file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});let loggedIn='',client='';page.setDefaultTimeout(15000);
  await page.route('http://127.0.0.1:3001/api/**',async route=>{try{const url=new URL(route.request().url());if(url.pathname==='/api/auth/code/request'){client=route.request().headers()['x-auth-client-id'];if(JSON.parse(route.request().postData()!).kind==='phone'){expect(client).toMatch(/^[-A-Za-z0-9_]{8,128}$/);await withSmsRequestHints({clientId:client,userAgent:route.request().headers()['user-agent']},()=>risk.check(phone(),'127.0.0.1','login'));}}const response=await route.fetch({url:base+url.pathname+url.search,timeout:15000});if(url.pathname==='/api/auth/code/verify'&&response.status()===201)loggedIn=(await response.json()).userId;await route.fulfill({response});}catch(error){if(!/already handled|closed/.test(String(error)))throw error;}});
  const limit=override('AUTH_SMS_CLIENT_SEND_LIMIT',1);
  try{await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/auth/login');await page.getByRole('tab',{name:'手机号',exact:true}).click();await page.getByLabel('手机号码',{exact:true}).fill(number);await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('短信请求较多，请稍后重试，或使用邮箱、密码登录。',{exact:true}).waitFor();await page.getByText('10 分钟后重试',{exact:true}).waitFor();expect(await page.getByRole('button',{name:'10 分钟后重试',exact:true}).isDisabled()).toBe(true);await page.screenshot({path:path.join(screenshots,'m3-risk-cooldown.png'),fullPage:true});
   await page.getByRole('tab',{name:'邮箱',exact:true}).click();await page.getByRole('textbox',{name:'邮箱',exact:true}).fill(address);await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor();await page.getByLabel('验证码',{exact:true}).fill(delivered.find(item=>item.recipient===address)!.code);await page.getByRole('button',{name:'验证并登录',exact:true}).click();await page.waitForURL('**/schedule');expect(loggedIn).toBe(s.userId);expect(delivered.filter(item=>item.channel==='phone')).toHaveLength(0);await page.screenshot({path:path.join(screenshots,'m3-risk-email-fallback.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }finally{limit.mockRestore();await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 },90000);
});
