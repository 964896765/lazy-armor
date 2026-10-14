import { HttpException, Inject, Injectable, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authSmsRiskSubjects as subjects, authSmsRiskEvents as events } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { workerEnabled } from '../common/app-role';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { normalizeIdentifier } from './login-identifier';
import { currentSmsRequestHints, type SmsRequestHints } from './sms-request-context';

const unavailable=()=>new HttpException({code:'SMS_RISK_SERVICE_UNAVAILABLE',message:'短信验证暂时不可用，请使用邮箱或密码。'},503);
const purposes=['login','email-bind-current','phone-bind-current','phone-bind-target','phone-change-current','phone-change-target'];
const WINDOW_MS=600000;
class DayChanged extends Error {}
type Decision={allowed:boolean;retryAfterMs:number};
type Fingerprints=NonNullable<typeof subjects.$inferSelect.fingerprintsJson>;

@Injectable()
export class SmsAbuseService implements OnModuleInit,OnApplicationShutdown {
 private ready=false;
 private readonly namespace:string;
 private timer?:ReturnType<typeof setInterval>;
 private cleanupWork?:Promise<void>;
 constructor(@Inject(DATABASE) private readonly db:InjectedDatabase,private readonly config:ConfigService,private readonly limiter:RateLimiterService) {this.namespace=config.get<string>('REDIS_KEY_PREFIX')??'lazyarmor';}
 enabled(){return this.config.get<string>('AUTH_SMS_ABUSE_GUARD_ENABLED')==='true';}
 available(){return this.ready&&this.enabled();}
 capabilities(){return {smsRequestProtection:{enabled:this.available(),clientMarkerRequired:this.available(),retentionDays:this.limit('AUTH_SMS_RISK_RETENTION_DAYS',7)}};}
 async onModuleInit(){
  if(!this.enabled()&&this.config.get<string>('AUTH_SMS_RISK_CLEANUP_ENABLED')!=='true')return;
  const secret=this.config.get<string>('AUTH_SMS_ABUSE_SECRET');
  if(this.namespace.length>160||(this.enabled()&&(!secret||secret.length<32)))throw new Error('SMS request protection requires independent secret');
  await this.bounded(async()=>{await this.db.select({id:subjects.id}).from(subjects).limit(1);await this.db.select({id:events.id}).from(events).limit(1);});
  this.ready=true;
  if(workerEnabled('outbox-worker'))this.timer=setInterval(()=>{if(this.cleanupWork)return;this.cleanupWork=this.cleanup().catch(()=>undefined).finally(()=>{this.cleanupWork=undefined;});},3600000);
 }
 private digest(kind:string,value:string){return createHmac('sha256',this.config.getOrThrow<string>('AUTH_SMS_ABUSE_SECRET')).update('sms-risk-v1:'+kind+':'+value).digest('hex');}
 private limit(key:string,fallback:number){const value=Number(this.config.get<number>(key)??fallback);if(!Number.isSafeInteger(value)||value<=0||value>100000)throw unavailable();return value;}
 private async bounded<T>(work:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),2000);})]);}
  catch(error){if(error instanceof HttpException||error instanceof DayChanged)throw error;throw unavailable();}
  finally{clearTimeout(timer!);}
 }
 private async clock(tx:AuthTransaction){const [rows]=await tx.execute(sql`SELECT TIMESTAMPDIFF(MICROSECOND,'1970-01-01',UTC_TIMESTAMP(6))/1000 AS milliseconds`);const now=Number((rows as unknown as Array<{milliseconds:string}>)[0]?.milliseconds);if(!Number.isFinite(now)||now<=0)throw unavailable();return Math.floor(now);}
 private address(value:string){
  const family=isIP(value);if(!family)throw unavailable();if(family===4)return value;
  try{const canonical=new URL('http://['+value+']/').hostname.slice(1,-1);const mapped=/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);if(mapped){const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16);return [a>>>8,a&255,b>>>8,b&255].join('.');}return canonical;}catch{throw unavailable();}
 }
 private day(now:number){return new Date(now+8*3600000).toISOString().slice(0,10);}
 private async row(tx:AuthTransaction,kind:string,subjectKey:string,now:number){
  const where=and(eq(subjects.quotaNamespace,this.namespace),eq(subjects.kind,kind),eq(subjects.subjectKey,subjectKey));
  await tx.insert(subjects).values({id:newId(),quotaNamespace:this.namespace,kind,subjectKey,windowStartedAt:new Date(now),createdAt:new Date(now),updatedAt:new Date(now)}).onDuplicateKeyUpdate({set:{id:sql`${subjects.id}`}});
  const [row]=await tx.select().from(subjects).where(where).limit(1).for('update');if(!row)throw unavailable();return row;
 }
 private update(row:typeof subjects.$inferSelect,now:number,phoneKey:string,ipKey:string,agentKey:string){
  if(row.blockedUntil&&row.blockedUntil.getTime()>now)return {row,reason:'ACTIVE_BLOCK',start:row.windowStartedAt.getTime(),blockedUntil:row.blockedUntil.getTime(),count:row.requestCount,fingerprints:row.fingerprintsJson??{phones:[],ips:[],agents:[]}};
  const reset=Boolean(row.blockedUntil)||now-row.windowStartedAt.getTime()>=WINDOW_MS;
  const start=reset?now:row.windowStartedAt.getTime();
  const old:Fingerprints=reset?{phones:[],ips:[],agents:[]}:row.fingerprintsJson??{phones:[],ips:[],agents:[]};
  const add=(values:string[],value:string)=>values.includes(value)?values:[...values,value];
  const fingerprints:Fingerprints={phones:add(old.phones,phoneKey),ips:row.kind==='client'?add(old.ips,ipKey):[],agents:row.kind==='client'?add(old.agents,agentKey):[]};
  const count=(reset?0:row.requestCount)+1;
  const reason=row.kind==='client'?(count>this.limit('AUTH_SMS_CLIENT_SEND_LIMIT',5)?'CLIENT_SEND':fingerprints.phones.length>this.limit('AUTH_SMS_CLIENT_PHONE_LIMIT',3)?'CLIENT_PHONES':fingerprints.ips.length>this.limit('AUTH_SMS_CLIENT_IP_LIMIT',2)?'CLIENT_IPS':fingerprints.agents.length>this.limit('AUTH_SMS_CLIENT_AGENT_LIMIT',2)?'CLIENT_AGENTS':'ALLOW'):(fingerprints.phones.length>this.limit('AUTH_SMS_IP_PHONE_LIMIT',5)?'IP_PHONES':'ALLOW');
  // A rejected request does not extend an existing block indefinitely.
  return {row,reason,start,blockedUntil:reason==='ALLOW'?null:now+WINDOW_MS,count,fingerprints};
 }
 async check(phone:string,ip:string,purpose:string,hints:SmsRequestHints|undefined=currentSmsRequestHints()):Promise<void>{
  if(!this.enabled())return;
  if(!this.available())throw unavailable();
  // Broad admission bounds DB cardinality; the durable daily cap survives Redis loss.
  const admission=await this.limiter.consume('sms-risk-admission',100,60);
  if(!admission.allowed)throw new HttpException({code:'SMS_RISK_BLOCKED',message:'短信请求较多，请稍后重试或使用邮箱、密码。',retryAfterMs:admission.retryAfterSeconds*1000},429);
  if(!hints?.clientId||!/^[-A-Za-z0-9_]{8,128}$/.test(hints.clientId))throw new HttpException({code:'SMS_CLIENT_CONTEXT_REQUIRED',message:'请更新客户端后重试，也可使用邮箱或密码。'},400);
  const address=this.address(ip);
  if(!purposes.includes(purpose))throw unavailable();
  const clientKey=this.digest('client',hints.clientId),ipKey=this.digest('ip',address),phoneKey=this.digest('phone',normalizeIdentifier('phone',phone)),agentKey=this.digest('agent',(hints.userAgent??'').slice(0,256));
  const decision=await this.bounded(async()=>{
   for(let attempt=0;;attempt++){
    try{return await authTransaction(this.db,async tx=>{
     const initial=await this.clock(tx),day=this.day(initial),global=await this.row(tx,'day',this.digest('day',day),initial),now=await this.clock(tx);
     if(this.day(now)!==day)throw new DayChanged();
     if(global.requestCount>=this.limit('AUTH_SMS_RISK_DAILY_REQUEST_LIMIT',500))return {allowed:false,retryAfterMs:Math.max(1,Date.parse(day+'T16:00:00Z')-now)};
     await tx.update(subjects).set({requestCount:global.requestCount+1,updatedAt:new Date(now)}).where(eq(subjects.id,global.id));
     const client=await this.row(tx,'client',clientKey,now),source=await this.row(tx,'ip',ipKey,now);
     const decidedAt=await this.clock(tx);
     if(this.day(decidedAt)!==day)throw new DayChanged();
     const rows=[this.update(client,decidedAt,phoneKey,ipKey,agentKey),this.update(source,decidedAt,phoneKey,ipKey,agentKey)];
     for(const value of rows)await tx.update(subjects).set({windowStartedAt:new Date(value.start),requestCount:value.count,fingerprintsJson:value.fingerprints,blockedUntil:value.blockedUntil?new Date(value.blockedUntil):null,updatedAt:new Date(decidedAt)}).where(eq(subjects.id,value.row.id));
     const blocked=rows.filter(value=>value.reason!=='ALLOW');
     await tx.insert(events).values({id:newId(),quotaNamespace:this.namespace,clientKey,ipKey,phoneKey,purpose,decision:blocked.length?'BLOCK':'ALLOW',reason:blocked[0]?.reason??'ALLOW',createdAt:new Date(decidedAt)});
     return {allowed:blocked.length===0,retryAfterMs:blocked.length?Math.max(...blocked.map(value=>value.blockedUntil!-decidedAt)):0} satisfies Decision;
    });}catch(error){if(!(error instanceof DayChanged)||attempt>=2)throw error;}
   }
  });
  // Throw outside the transaction: blocked evidence and cooldown must commit.
  if(!decision.allowed)throw new HttpException({code:'SMS_RISK_BLOCKED',message:'短信请求较多，请稍后重试或使用邮箱、密码。',retryAfterMs:Math.ceil(decision.retryAfterMs)},429);
 }
 async cleanup(){
  if(!this.ready)return;
  const days=this.limit('AUTH_SMS_RISK_RETENTION_DAYS',7);
  await this.bounded(async()=>{
   const oldEvents=await this.db.select({id:events.id}).from(events).where(and(eq(events.quotaNamespace,this.namespace),sql`${events.createdAt} < DATE_SUB(UTC_TIMESTAMP(6),INTERVAL ${days} DAY)`)).limit(1000);
   if(oldEvents.length)await this.db.delete(events).where(and(eq(events.quotaNamespace,this.namespace),inArray(events.id,oldEvents.map(row=>row.id))));
   const oldSubjects=await this.db.select({id:subjects.id}).from(subjects).where(and(eq(subjects.quotaNamespace,this.namespace),sql`${subjects.updatedAt} < DATE_SUB(UTC_TIMESTAMP(6),INTERVAL ${days} DAY)`)).limit(1000);
   // Recheck age at delete, so a concurrent active request never loses its budget.
   if(oldSubjects.length)await this.db.delete(subjects).where(and(eq(subjects.quotaNamespace,this.namespace),inArray(subjects.id,oldSubjects.map(row=>row.id)),sql`${subjects.updatedAt} < DATE_SUB(UTC_TIMESTAMP(6),INTERVAL ${days} DAY)`));
  });
 }
 async onApplicationShutdown(){if(this.timer)clearInterval(this.timer);await this.cleanupWork;}
}
