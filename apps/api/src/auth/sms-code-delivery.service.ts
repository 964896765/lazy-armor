import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authSmsAttempts, authSmsQuotas } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { normalizeIdentifier } from './login-identifier';

const unavailable = () => new HttpException({code:'LOGIN_CODE_SERVICE_UNAVAILABLE',message:'验证服务暂不可用，请稍后重试。'},503);
const purposes = ['login','email-bind-current','phone-bind-current','phone-bind-target','phone-change-current','phone-change-target','security-phone-changed'];
class DayChanged extends Error {}
export interface SmsReservation { id:string; bucket:string; reservedFen:number }

@Injectable()
export class SmsCodeDeliveryService implements OnModuleInit {
  private ready = false;
  private readonly namespace: string;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService) {
    this.namespace = config.get<string>('REDIS_KEY_PREFIX') ?? 'lazyarmor';
  }
  async onModuleInit() {
    if (this.config.get<string>('SMS_LOGIN_SEND_ENABLED') !== 'true') return;
    if (!this.gateway() || this.namespace.length > 160) throw new Error('Enabled SMS requires approved gateway configuration');
    try {
      await this.bounded(async () => {
        await this.db.select({id:authSmsQuotas.id}).from(authSmsQuotas).limit(1);
        await this.db.select({id:authSmsAttempts.id}).from(authSmsAttempts).limit(1);
      });
    } catch { throw new Error('Enabled SMS requires readable 0094 quota and attempt tables'); }
    this.ready = true;
  }
  private gateway() {
    if (this.config.get<string>('SMS_LOGIN_SEND_ENABLED') !== 'true') return null;
    const endpoint = this.config.get<string>('SMS_LOGIN_DELIVERY_ENDPOINT');
    const token = this.config.get<string>('LOGIN_CODE_DELIVERY_TOKEN');
    const secret = this.config.get<string>('SMS_LOGIN_QUOTA_SECRET');
    const templateId = this.config.get<string>('SMS_LOGIN_TEMPLATE_ID');
    try {
      const url = new URL(endpoint ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || !token || token.length < 32 || !secret || secret.length < 32 || !/^[A-Za-z0-9_-]{1,100}$/.test(templateId ?? '')) return null;
      return {endpoint:endpoint!,token,templateId:templateId!};
    } catch { return null; }
  }
  available() { return this.ready && Boolean(this.gateway()); }
  private assertAvailable() { if (!this.available()) throw new HttpException({code:'SMS_CODE_UNAVAILABLE',message:'短信验证码暂未开放，请选择邮箱或密码登录。'},503); }
  private digest(kind:string,value:string) { return createHmac('sha256',this.config.getOrThrow<string>('SMS_LOGIN_QUOTA_SECRET')).update('sms-quota-v1:'+kind+':'+value).digest('hex'); }
  private limit(key:string,fallback:number) { const value=Number(this.config.get<number>(key)??fallback);if(!Number.isSafeInteger(value)||value<=0||value>100000000)throw unavailable();return value; }
  private async bounded<T>(work:()=>Promise<T>,milliseconds=2000):Promise<T> {
    let timer:ReturnType<typeof setTimeout>;
    try { return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),milliseconds);})]); }
    catch(error) { if(error instanceof HttpException||error instanceof DayChanged)throw error;throw unavailable(); }
    finally { clearTimeout(timer!); }
  }
  private async clock(tx:AuthTransaction) {
    const [rows] = await tx.execute(sql`SELECT TIMESTAMPDIFF(MICROSECOND,'1970-01-01',UTC_TIMESTAMP(6))/1000 AS milliseconds`);
    const now=Number((rows as unknown as Array<{milliseconds:string}>)[0]?.milliseconds);
    if(!Number.isFinite(now)||now<=0)throw unavailable();return now;
  }
  private bucket(now:number) { return new Date(now+8*3600000).toISOString().slice(0,10); }
  private async row(tx:AuthTransaction,bucket:string,kind:string,subjectKey:string) {
    const where=and(eq(authSmsQuotas.quotaNamespace,this.namespace),eq(authSmsQuotas.bucket,bucket),eq(authSmsQuotas.kind,kind),eq(authSmsQuotas.subjectKey,subjectKey));
    const now=new Date();
    await tx.insert(authSmsQuotas).values({id:newId(),quotaNamespace:this.namespace,bucket,kind,subjectKey,createdAt:now,updatedAt:now}).onDuplicateKeyUpdate({set:{id:sql`${authSmsQuotas.id}`}});
    const [row]=await tx.select().from(authSmsQuotas).where(where).limit(1).for('update');
    if(!row)throw unavailable();return row;
  }
  async reserve(phone:string,ip:string,purpose:string):Promise<SmsReservation> {
    this.assertAvailable();phone=normalizeIdentifier('phone',phone);
    if(!purposes.includes(purpose))throw new HttpException('不支持此短信验证用途',400);
    const phoneKey=this.digest('phone',phone),ipKey=this.digest('ip',ip),reservedFen=this.limit('SMS_LOGIN_MAX_UNIT_COST_FEN',10);
    return this.bounded(async()=>{
      for(let attempt=0;;attempt++) {
        try { return await authTransaction(this.db,async tx=>{
          const bucket=this.bucket(await this.clock(tx));
          // Identical lock order for all replicas and verification purposes.
          const global=await this.row(tx,bucket,'channel','0'.repeat(64));
          const interval=await this.row(tx,'interval','phone',phoneKey);
          const number=await this.row(tx,bucket,'phone',phoneKey),address=await this.row(tx,bucket,'ip',ipKey);
          const now=await this.clock(tx); // Refresh after waiting for locks.
          if(this.bucket(now)!==bucket)throw new DayChanged();
          const wait=interval.lastReservedAt?60000-(now-interval.lastReservedAt.getTime()):0;
          if(wait>0)throw new HttpException({code:'SMS_CODE_COOLDOWN',message:'请稍后再获取短信验证码。',retryAfterMs:Math.ceil(wait)},429);
          const retryAfterMs=Math.max(1,Math.ceil(Date.parse(bucket+'T16:00:00Z')-now));
          if(number.sendCount>=this.limit('SMS_LOGIN_PHONE_DAILY_LIMIT',5)||address.sendCount>=this.limit('SMS_LOGIN_IP_DAILY_LIMIT',20))throw new HttpException({code:'SMS_CODE_DAILY_LIMIT',message:'今日短信验证次数已达上限，请使用邮箱或密码。',retryAfterMs},429);
          if(global.sendCount>=this.limit('SMS_LOGIN_GLOBAL_DAILY_LIMIT',100)||global.reservedFen+reservedFen>this.limit('SMS_LOGIN_DAILY_BUDGET_FEN',1000))throw new HttpException({code:'SMS_CODE_CHANNEL_LIMIT',message:'短信验证暂时不可用，请使用邮箱或密码。',retryAfterMs},429);
          const timestamp=new Date(Math.ceil(now));
          for(const row of [global,number,address])await tx.update(authSmsQuotas).set({sendCount:row.sendCount+1,reservedFen:row.reservedFen+reservedFen,lastReservedAt:timestamp,updatedAt:timestamp}).where(eq(authSmsQuotas.id,row.id));
          await tx.update(authSmsQuotas).set({lastReservedAt:timestamp,updatedAt:timestamp}).where(eq(authSmsQuotas.id,interval.id));
          const id=newId();
          await tx.insert(authSmsAttempts).values({id,quotaNamespace:this.namespace,bucket,phoneKey,ipKey,purpose,state:'RESERVED',reservedFen,createdAt:timestamp,updatedAt:timestamp});
          return {id,bucket,reservedFen};
        }); } catch(error) { if(!(error instanceof DayChanged)||attempt>=2)throw error; }
      }
    });
  }
  async mark(id:string,state:string,acceptedCostFen?:number,providerId?:string) {
    await this.bounded(async()=>{
      await this.db.update(authSmsAttempts).set({state,acceptedCostFen,providerKey:providerId?this.digest('provider',providerId):undefined,updatedAt:new Date()}).where(and(eq(authSmsAttempts.id,id),eq(authSmsAttempts.quotaNamespace,this.namespace),eq(authSmsAttempts.state,'RESERVED')));
    },1000);
  }
  async deliver(phone:string,ip:string,code:string,purpose:string) {
    if (purpose === 'security-phone-changed') throw new HttpException('安全通知须使用独立模板网关',400);
    const reservation=await this.reserve(phone,ip,purpose);
    // Never refund attempted/unknown delivery and never retry a gateway POST.
    const gateway=this.gateway();
    if(!gateway) { await this.mark(reservation.id,'CANCELLED');this.assertAvailable();throw unavailable(); }
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    try {
      const ack=await Promise.race([
        (async()=>{
          const response=await fetch(gateway.endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+gateway.token,'content-type':'application/json','idempotency-key':reservation.id},body:JSON.stringify({type:'login_code',contractVersion:2,purpose,channel:'phone',recipient:normalizeIdentifier('phone',phone),code,expiresIn:300,requestId:reservation.id,templateId:gateway.templateId,budgetDay:reservation.bucket,maxCostFen:reservation.reservedFen}),signal:controller.signal});
          if(!response.ok)throw unavailable();
          const value=await response.json() as Record<string,unknown>;
          if(value.accepted!==true||value.requestId!==reservation.id||typeof value.providerRequestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.providerRequestId)||!Number.isSafeInteger(value.costFen)||Number(value.costFen)<0||Number(value.costFen)>reservation.reservedFen)throw unavailable();
          return {costFen:Number(value.costFen),providerId:value.providerRequestId};
        })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},4000);}),
      ]);
      await this.mark(reservation.id,'ACCEPTED',ack.costFen,ack.providerId);
      return {accepted:true};
    } catch {
      await this.mark(reservation.id,'UNKNOWN').catch(()=>undefined);
      throw new HttpException({code:'SMS_CODE_DELIVERY_FAILED',message:'短信请求未能确认，请稍后重试，也可使用邮箱或密码。'},503);
    } finally { clearTimeout(timer!);controller.abort(); }
  }
}
