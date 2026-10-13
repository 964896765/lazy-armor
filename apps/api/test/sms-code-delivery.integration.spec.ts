import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootP2App } from './p2-test-helpers';
import { SmsCodeDeliveryService } from '../src/auth/sms-code-delivery.service';
import { LoginCodeService } from '../src/auth/login-code.service';
import { AuthService } from '../src/auth/auth.service';

describe.sequential('M3-02 durable SMS limits and gateway contract',()=>{
  let app:INestApplication,pool:Pool,sms:SmsCodeDeliveryService,codes:LoginCodeService,redis:IORedis,prefix:string;
  const keys=['SMS_LOGIN_SEND_ENABLED','SMS_LOGIN_TEMPLATE_ID','SMS_LOGIN_QUOTA_SECRET','SMS_LOGIN_DELIVERY_ENDPOINT','EMAIL_LOGIN_DELIVERY_ENDPOINT','LOGIN_CODE_DELIVERY_TOKEN','REDIS_KEY_PREFIX','TEST_REDIS_KEY_PREFIX','PUBLIC_REGISTRATION'] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const deliveries:Array<Record<string,any>>=[];
  const phone=()=>'+86139'+String(Math.floor(Math.random()*100000000)).padStart(8,'0');
  beforeAll(async()=>{
    prefix=process.env.REDIS_KEY_PREFIX!+':sms-budget-tests';process.env.REDIS_KEY_PREFIX=process.env.TEST_REDIS_KEY_PREFIX=prefix;
    process.env.SMS_LOGIN_SEND_ENABLED='true';process.env.SMS_LOGIN_TEMPLATE_ID='fixture-login';process.env.SMS_LOGIN_QUOTA_SECRET='sms-budget-fixture-secret-that-is-longer-than-32';
    process.env.SMS_LOGIN_DELIVERY_ENDPOINT=process.env.EMAIL_LOGIN_DELIVERY_ENDPOINT='https://sms-budget.fixture.test';process.env.LOGIN_CODE_DELIVERY_TOKEN='sms-gateway-fixture-token-that-is-longer-than-32';process.env.PUBLIC_REGISTRATION='true';
    ({app,pool}=await bootP2App('sms-budgets'));sms=app.get(SmsCodeDeliveryService);codes=app.get(LoginCodeService);redis=new IORedis(process.env.REDIS_URL!);
  });
  beforeEach(async()=>{
    vi.restoreAllMocks();deliveries.length=0;
    await pool.execute('DELETE FROM auth_sms_attempts WHERE quota_namespace=?',[prefix]);await pool.execute('DELETE FROM auth_sms_quotas WHERE quota_namespace=?',[prefix]);
    const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
      expect(String(url)).toBe(process.env.SMS_LOGIN_DELIVERY_ENDPOINT);expect(options.redirect).toBe('error');
      const body=JSON.parse(String(options.body));deliveries.push(body);
      if(body.channel==='phone')expect((options.headers as any)['idempotency-key']).toBe(body.requestId);
      return {ok:true,json:async()=>({accepted:true,requestId:body.requestId,providerRequestId:'fixture-provider',costFen:3})};
    }));
  });
  afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();await redis?.quit();await pool?.end();await app?.close();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const send=(number:string)=>request(app.getHttpServer()).post('/api/auth/code/request').send({kind:'phone',identifier:number});
  const verify=(number:string,code:string)=>request(app.getHttpServer()).post('/api/auth/code/verify').send({kind:'phone',identifier:number,code});
  async function attempts(){return (await pool.execute<RowDataPacket[]>('SELECT * FROM auth_sms_attempts WHERE quota_namespace=?',[prefix]))[0];}
  async function channel(){return (await pool.execute<RowDataPacket[]>("SELECT send_count,reserved_fen FROM auth_sms_quotas WHERE quota_namespace=? AND kind='channel'",[prefix]))[0][0];}
  async function releaseInterval(){await pool.execute("UPDATE auth_sms_quotas SET last_reserved_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 61 SECOND) WHERE quota_namespace=? AND bucket='interval'",[prefix]);}
  function limit(name:string,value:number|string){const config=(sms as any).config,get=config.get.bind(config);return vi.spyOn(config,'get').mockImplementation((...args:any[])=>args[0]===name?value:get(...args));}

  it('accepts only the approved OTP contract and logs hashes and conservative cost, then enters one user',async()=>{
    const number=phone(),result=await send(number).expect(201);
    expect(result.body).toMatchObject({sent:true,delivery:'GATEWAY_ACCEPTED',retryAfterSeconds:60});expect(result.body).not.toHaveProperty('code');
    expect(deliveries[0]).toMatchObject({type:'login_code',contractVersion:2,purpose:'login',channel:'phone',recipient:number,templateId:'fixture-login',maxCostFen:10});
    const rows=await attempts();expect(rows[0]).toMatchObject({state:'ACCEPTED',reserved_fen:10,accepted_cost_fen:3});
    const material=JSON.stringify(rows);for(const secret of [number,deliveries[0].code,process.env.LOGIN_CODE_DELIVERY_TOKEN!,process.env.SMS_LOGIN_QUOTA_SECRET!])expect(material).not.toContain(secret);
    expect(await channel()).toMatchObject({send_count:1,reserved_fen:10});
    const logged=await verify(number,deliveries[0].code).expect(201);expect(logged.body.userId).toBeTruthy();await verify(number,deliveries[0].code).expect(401);
  });
  it('enforces a real 60-second interval across purposes despite an app clock/window change',async()=>{
    const number=phone();await send(number).expect(201);
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+3600000);
    try {await expect(sms.reserve(number,'other-ip','phone-bind-target')).rejects.toMatchObject({status:429,response:{code:'SMS_CODE_COOLDOWN'}});}finally{clock.mockRestore();}
    const blocked=await send(number).expect(429);expect(blocked.body).toMatchObject({code:'SMS_CODE_COOLDOWN'});expect(blocked.body.retryAfterMs).toBeGreaterThan(50000);expect(deliveries).toHaveLength(1);
    await releaseInterval();await send(number).expect(201);expect(deliveries).toHaveLength(2);
  });
  it('parallel send purposes and replicas reserve one phone once',async()=>{
    const number=phone(),results=await Promise.allSettled(Array.from({length:4},(_,n)=>sms.reserve(number,'ip-'+n,n%2?'phone-bind-target':'login')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await attempts()).toHaveLength(1);expect(await channel()).toMatchObject({send_count:1,reserved_fen:10});
  });
  it('bounds a number to five daily reservations, with no extra attempt when blocked',async()=>{
    const number=phone();for(let n=0;n<5;n++){await sms.reserve(number,'phone-day','login');await releaseInterval();}
    await expect(sms.reserve(number,'other-ip','phone-bind-target')).rejects.toMatchObject({response:{code:'SMS_CODE_DAILY_LIMIT'}});expect(await attempts()).toHaveLength(5);
  });
  it('bounds daily IP reservations independently of different numbers',async()=>{
    const spy=limit('SMS_LOGIN_IP_DAILY_LIMIT',2);
    try {await sms.reserve(phone(),'daily-ip','login');await sms.reserve(phone(),'daily-ip','login');await expect(sms.reserve(phone(),'daily-ip','login')).rejects.toMatchObject({response:{code:'SMS_CODE_DAILY_LIMIT'}});}finally{spy.mockRestore();}
    expect(await attempts()).toHaveLength(2);
  });
  it('forwarded-IP headers cannot evade the default untrusted-proxy quota',async()=>{
    const spy=limit('SMS_LOGIN_IP_DAILY_LIMIT',1);
    try {await send(phone()).set('X-Forwarded-For','192.0.2.1').expect(201);const r=await send(phone()).set('X-Forwarded-For','192.0.2.2').expect(429);expect(r.body.code).toBe('SMS_CODE_DAILY_LIMIT');}finally{spy.mockRestore();}
    expect(deliveries).toHaveLength(1);
  });
  it('global count limits survive a fresh service instance and Redis budget deletion',async()=>{
    const spy=limit('SMS_LOGIN_GLOBAL_DAILY_LIMIT',2);
    try {
      await send(phone()).expect(201);await send(phone()).expect(201);
      const budgets=await redis.keys(prefix+':ratelimit:*');if(budgets.length)await redis.del(...budgets);
      const replica=new SmsCodeDeliveryService((sms as any).db,(sms as any).config);await replica.onModuleInit();
      await expect(replica.reserve(phone(),'replica','login')).rejects.toMatchObject({response:{code:'SMS_CODE_CHANNEL_LIMIT'}});
    } finally{spy.mockRestore();}
    expect(await channel()).toMatchObject({send_count:2,reserved_fen:20});
  });
  it('reserves the maximum cost and refuses a spend above the durable daily budget',async()=>{
    const spy=limit('SMS_LOGIN_DAILY_BUDGET_FEN',15);
    try {await send(phone()).expect(201);const blocked=await send(phone()).expect(429);expect(blocked.body.code).toBe('SMS_CODE_CHANNEL_LIMIT');}finally{spy.mockRestore();}
    expect(deliveries).toHaveLength(1);expect(await channel()).toMatchObject({send_count:1,reserved_fen:10});
  });
  it('resets daily quotas at China midnight while preserving the phone interval',async()=>{
    const number=phone(),before=Date.parse('2026-10-13T15:59:59.500Z'),clock=vi.spyOn(sms as any,'clock').mockResolvedValue(before),quota=limit('SMS_LOGIN_PHONE_DAILY_LIMIT',1);
    try {
      expect((await sms.reserve(number,'midnight','login')).bucket).toBe('2026-10-13');
      clock.mockResolvedValue(before+1000);await expect(sms.reserve(number,'midnight','login')).rejects.toMatchObject({response:{code:'SMS_CODE_COOLDOWN'}});
      clock.mockResolvedValue(before+61000);expect((await sms.reserve(number,'midnight','login')).bucket).toBe('2026-10-14');
    }finally{clock.mockRestore();quota.mockRestore();}
    expect(await attempts()).toHaveLength(2);
  });
  it('rolls back the old day if midnight occurs while waiting for quota locks',async()=>{
    const before=Date.parse('2026-10-13T15:59:59.500Z'),clock=vi.spyOn(sms as any,'clock').mockResolvedValue(before+1000).mockResolvedValueOnce(before);
    try {expect((await sms.reserve(phone(),'day-rollover','login')).bucket).toBe('2026-10-14');}finally{clock.mockRestore();}
    const rows=await attempts();expect(rows).toHaveLength(1);expect(rows[0].bucket).toBe('2026-10-14');
    const [old]=await pool.execute<RowDataPacket[]>("SELECT id FROM auth_sms_quotas WHERE quota_namespace=? AND bucket='2026-10-13'",[prefix]);expect(old).toHaveLength(0);
  });
  it.each(['refused','wrong-id','over-price','invalid-json'])('a %s gateway response cannot issue an OTP or refund uncertain cost',async mode=>{
    const number=phone();vi.mocked(globalThis.fetch).mockImplementationOnce(async(_url,options)=>{
      const body=JSON.parse(String(options!.body));deliveries.push(body);
      return {ok:mode!=='refused',json:async()=>{if(mode==='invalid-json')throw new Error('private-json-failure');return {accepted:true,requestId:mode==='wrong-id'?'wrong':body.requestId,providerRequestId:'fixture',costFen:mode==='over-price'?11:3};}} as Response;
    });
    const failed=await send(number).expect(503);expect(failed.body.code).toBe('SMS_CODE_DELIVERY_FAILED');expect(JSON.stringify(failed.body)).not.toContain('private-json-failure');
    await verify(number,deliveries[0].code).expect(401);expect((await attempts())[0].state).toBe('UNKNOWN');expect(await channel()).toMatchObject({reserved_fen:10});await send(number).expect(429);
  });
  it('a late gateway acknowledgement after the real deadline cannot issue a code or retry',async()=>{
    let release!:(response:Response)=>void;
    vi.mocked(globalThis.fetch).mockImplementationOnce(async(_url,options)=>{deliveries.push(JSON.parse(String(options!.body)));return new Promise<Response>(resolve=>{release=resolve;});});
    const number=phone(),started=performance.now();await send(number).expect(503);expect(performance.now()-started).toBeLessThan(7000);expect(deliveries).toHaveLength(1);
    release({ok:true,json:async()=>({accepted:true,requestId:deliveries[0].requestId,providerRequestId:'late',costFen:3})} as Response);
    await new Promise(resolve=>setTimeout(resolve,50));expect((await attempts())[0].state).toBe('UNKNOWN');await verify(number,deliveries[0].code).expect(401);expect(await channel()).toMatchObject({reserved_fen:10});
  },10000);
  it('a stalled acknowledgement body also obeys the delivery deadline',async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ok:true,json:()=>new Promise(()=>{})} as Response);
    const started=performance.now();await send(phone()).expect(503);expect(performance.now()-started).toBeLessThan(7000);expect((await attempts())[0].state).toBe('UNKNOWN');
  },10000);
  it('the kill switch stops new reservations and capability while retaining already issued login OTP',async()=>{
    const number=phone();await send(number).expect(201);const spy=limit('SMS_LOGIN_SEND_ENABLED','false');
    try {expect(codes.availability('phone')).toBe('UNAVAILABLE');await send(phone()).expect(503);await verify(number,deliveries[0].code).expect(201);}finally{spy.mockRestore();}
    expect(deliveries).toHaveLength(1);expect(await attempts()).toHaveLength(1);
  });
  it('checks the kill switch again between reservation and outbound dispatch',async()=>{
    const original=sms.reserve.bind(sms);let flag:{mockRestore:()=>void}|undefined;
    const spy=vi.spyOn(sms,'reserve').mockImplementation(async(...args)=>{const result=await original(...args);flag=limit('SMS_LOGIN_SEND_ENABLED','false');return result;});
    try {await send(phone()).expect(503);expect(deliveries).toHaveLength(0);expect((await attempts())[0].state).toBe('CANCELLED');}finally{flag?.mockRestore();spy.mockRestore();}
  });
  it('a real SQL lock timeout returns promptly and a late reservation never dispatches SMS',async()=>{
    await sms.reserve(phone(),'seed','login');
    const connection=await pool.getConnection();await connection.beginTransaction();
    await connection.query("SELECT id FROM auth_sms_quotas WHERE quota_namespace=? AND kind='channel' FOR UPDATE",[prefix]);
    const started=performance.now();try {await send(phone()).expect(503);expect(performance.now()-started).toBeLessThan(4000);expect(deliveries).toHaveLength(0);}finally{await connection.rollback();connection.release();}
    await new Promise(resolve=>setTimeout(resolve,150));expect(await attempts()).toHaveLength(2);expect(deliveries).toHaveLength(0);expect(await channel()).toMatchObject({reserved_fen:20});
  },10000);
  it('unsupported purposes and client-supplied quota/price fields cannot issue an SMS',async()=>{
    await expect(sms.reserve(phone(),'ip','marketing')).rejects.toMatchObject({status:400});
    await request(app.getHttpServer()).post('/api/auth/code/request').send({kind:'phone',identifier:phone(),maxCostFen:0,purpose:'phone-bind-target'}).expect(400);
    expect(await attempts()).toHaveLength(0);expect(deliveries).toHaveLength(0);
  });
  it.skipIf(!process.env.AUTH_V2_BROWSER_EXECUTABLE)('real Chrome can use the bound email immediately after SMS daily capacity is exhausted',async()=>{
    const address='sms-fallback-'+randomUUID()+'@example.test',number=phone(),user=await app.get(AuthService).loginVerified('email',address,{});
    await pool.execute("INSERT INTO login_identifiers(id,user_id,kind,identifier,verified_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),'phone',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",[randomUUID(),user.userId,number]);
    await send(phone()).expect(201);const spy=limit('SMS_LOGIN_GLOBAL_DAILY_LIMIT',1);
    const {chromium}=await import('playwright-core'),{createServer}=await import('node:http'),{readFileSync,existsSync}=await import('node:fs'),path=await import('node:path');
    const dist=path.resolve(process.cwd(),'../mobile/dist'),screenshots=process.env.AUTH_V2_SCREENSHOT_DIR!;
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    const server=createServer((req,res)=>{const requested=path.resolve(dist,'.'+new URL(req.url!,'http://localhost').pathname),file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(readFileSync(file));});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({executablePath:process.env.AUTH_V2_BROWSER_EXECUTABLE,headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});let loggedIn='';
    page.setDefaultTimeout(15000);
    await page.route('http://127.0.0.1:3001/api/**',async route=>{try{const url=new URL(route.request().url()),response=await route.fetch({url:base+url.pathname+url.search,timeout:15000});if(url.pathname==='/api/auth/code/verify'&&response.status()===201)loggedIn=(await response.json()).userId;await route.fulfill({response});}catch(error){if(!/already handled|closed/.test(String(error)))throw error;}});
    try {
      await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/auth/login');await page.getByRole('tab',{name:'手机号',exact:true}).click();await page.getByLabel('手机号码',{exact:true}).fill(number);await page.getByRole('button',{name:'获取验证码',exact:true}).click();
      await page.getByText('短信验证暂时不可用，请选择邮箱或密码登录。',{exact:true}).waitFor();await page.screenshot({path:path.join(screenshots,'m3-sms-capacity.png'),fullPage:true});
      await page.getByRole('tab',{name:'邮箱',exact:true}).click();await page.getByRole('textbox',{name:'邮箱',exact:true}).fill(address);await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('验证码已发送，请在 5 分钟内输入。',{exact:true}).waitFor();
      await page.getByLabel('验证码',{exact:true}).fill(deliveries.find(item=>item.recipient===address)!.code);await page.getByRole('button',{name:'验证并登录',exact:true}).click();await page.waitForURL('**/schedule');expect(loggedIn).toBe(user.userId);
      await page.screenshot({path:path.join(screenshots,'m3-sms-email-fallback.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    } finally {await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));spy.mockRestore();}
  },60000);
});
