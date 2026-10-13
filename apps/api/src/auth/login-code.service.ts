import { LocalLoginCodeDeliveryProvider } from './local-login-code-delivery.provider';
import { Injectable, HttpException, UnauthorizedException, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { createHmac, randomInt } from 'node:crypto';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import type { RequestLoginCodeDto, VerifyLoginCodeDto } from './dto';
import { normalizeIdentifier } from './login-identifier';
import { SmsCodeDeliveryService } from './sms-code-delivery.service';
import { connectRequestRedis, createRequestRedis } from '../infrastructure/request-redis';
export type ChallengeScope = { purpose: 'email-bind' | 'password-set' | 'email-bind-current' | 'email-bind-target' | 'phone-bind-current' | 'phone-bind-target'; userId: string; context?: string };
@Injectable()
export class LoginCodeService implements OnApplicationShutdown {
 private redis: IORedis;
 private readonly redisUrl: string;
 constructor(private readonly config:ConfigService,private readonly limiter:RateLimiterService,private readonly localDelivery:LocalLoginCodeDeliveryProvider,private readonly sms:SmsCodeDeliveryService) {
  this.redisUrl=config.getOrThrow<string>('REDIS_URL');this.redis=createRequestRedis(this.redisUrl);
 }
 normalize(input:RequestLoginCodeDto) {
  return normalizeIdentifier(input.kind,input.identifier);
 }
 private digest(value:string) {return createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update(value).digest('hex');}
 private key(kind:string,value:string) {return `${this.config.get<string>('REDIS_KEY_PREFIX')??'lazyarmor'}:login-code:${this.digest(kind+':'+value)}`;}
 private challengeKey(kind:string,value:string,scope?:ChallengeScope) {return scope ? `${this.key(kind,value)}:${this.digest(scope.purpose+':'+scope.userId+(scope.context?':'+scope.context:''))}` : this.key(kind,value);}
 availability(kind: 'phone' | 'email'): 'LOCAL_DEVELOPMENT' | 'CONFIGURED' | 'UNAVAILABLE' {
  const endpoint=this.config.get<string>(kind==='phone'?'SMS_LOGIN_DELIVERY_ENDPOINT':'EMAIL_LOGIN_DELIVERY_ENDPOINT');
  if(this.localDelivery.available(endpoint)) return 'LOCAL_DEVELOPMENT';
  if(kind==='phone') return this.sms.available()?'CONFIGURED':'UNAVAILABLE';
  try { if(endpoint && new URL(endpoint).protocol==='https:' && this.config.get<string>('LOGIN_CODE_DELIVERY_TOKEN')) return 'CONFIGURED'; } catch {}
  return 'UNAVAILABLE';
 }
 async request(input:RequestLoginCodeDto,ip:string,scope?:ChallengeScope) {
  try { return await this.requestCode(input,ip,scope); }
  catch(error) { if(error instanceof HttpException)throw error;this.redis.disconnect();this.redis=createRequestRedis(this.redisUrl);throw new HttpException({code:'LOGIN_CODE_SERVICE_UNAVAILABLE',message:'验证服务暂不可用，请稍后重试。'},503); }
 }
 private async requestCode(input:RequestLoginCodeDto,ip:string,scope?:ChallengeScope) {
  const identifier=this.normalize(input);const key=this.challengeKey(input.kind,identifier,scope);
  const availability=this.availability(input.kind);
  if(availability==='UNAVAILABLE') throw new HttpException('验证码发送服务暂未开放，请稍后再试',503);
  const budgets:ReadonlyArray<readonly [string,number,number]>=input.kind==='phone'&&availability==='CONFIGURED'?[['otp-ip:'+ip,10,600]]:[[this.key(input.kind,identifier),1,60],['otp-ip:'+ip,10,600]];
  for(const [budget,limit,window] of budgets) { const result=await this.limiter.consume(budget,limit,window);if(!result.allowed)throw new HttpException({code:'LOGIN_CODE_RATE_LIMITED',message:'请稍后再获取验证码',retryAfterMs:result.retryAfterSeconds*1000},429); }
  const endpoint=this.config.get<string>(input.kind==='phone'?'SMS_LOGIN_DELIVERY_ENDPOINT':'EMAIL_LOGIN_DELIVERY_ENDPOINT');
  const token=this.config.get<string>('LOGIN_CODE_DELIVERY_TOKEN');
  const local=availability==='LOCAL_DEVELOPMENT';
  const code=String(randomInt(0,1000000)).padStart(6,'0');
  if(input.kind==='phone'&&!local) {
   const started=performance.now();
   await this.sms.deliver(identifier,ip,code,scope?.purpose??'login');
   await connectRequestRedis(this.redis);
   const expiresIn=Math.max(1,Math.ceil(300-(performance.now()-started)/1000));
   await this.redis.set(key,this.digest(key+':'+code),'EX',expiresIn);
   return {sent:true,delivery:'GATEWAY_ACCEPTED',retryAfterSeconds:60,expiresIn};
  }
  await connectRequestRedis(this.redis);
  await this.redis.set(key,this.digest(key+':'+code),'EX',300);
  if(local){this.localDelivery.deliver(input.kind,identifier,code,new Date(Date.now()+300000));return {sent:true,delivery:'LOCAL_DEVELOPMENT',retryAfterSeconds:60,expiresIn:300};}
  try {const response=await fetch(endpoint!,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({type:'login_code',purpose:scope?.purpose??'login',channel:input.kind,recipient:identifier,code,expiresIn:300}),signal:AbortSignal.timeout(8000)});if(!response.ok) throw new Error('delivery');}
  catch {await this.redis.del(key);throw new HttpException('验证码未能发送，请稍后重试',503);}
  return {sent:true,retryAfterSeconds:60,expiresIn:300};
 }
 async verify(input:VerifyLoginCodeDto,ip:string,scope?:ChallengeScope) {
  try { return await this.verifyCode(input,ip,scope); }
  catch(error) { if(error instanceof HttpException)throw error;this.redis.disconnect();this.redis=createRequestRedis(this.redisUrl);throw new HttpException({code:'LOGIN_CODE_SERVICE_UNAVAILABLE',message:'验证服务暂不可用，请稍后重试。'},503); }
 }
 private async verifyCode(input:VerifyLoginCodeDto,ip:string,scope?:ChallengeScope) {
  const identifier=this.normalize(input);const key=this.challengeKey(input.kind,identifier,scope);
  if(!(await this.limiter.consume('otp-verify:'+key,5,300)).allowed||!(await this.limiter.consume('otp-verify-ip:'+ip,30,300)).allowed) throw new HttpException('尝试次数过多，请稍后再试',429);
  await connectRequestRedis(this.redis);
  // Count against this stored code's remaining Redis TTL, independently of
  // wall-clock windows. Deployed string OTPs remain readable; no raw code is
  // added to a key. Different code digests have separate budgets; repeating
  // the same code value cannot reset its existing attempt count.
  const accepted=await this.redis.eval("local v=redis.call('GET',KEYS[1]);if not v then return 0 end;local k=KEYS[1]..':attempts:'..v;local n=redis.call('INCR',k);if n==1 then redis.call('PEXPIRE',k,math.max(redis.call('PTTL',KEYS[1]),1)) end;if n>5 then return -1 end;if v==ARGV[1] then redis.call('DEL',KEYS[1]);redis.call('DEL',k);return 1 end;return 0",1,key,this.digest(key+':'+input.code));
  if(Number(accepted)===-1) throw new HttpException('尝试次数过多，请重新获取验证码',429);
  if(Number(accepted)!==1) throw new UnauthorizedException('验证码不正确或已过期');
  return identifier;
 }
 async onApplicationShutdown(){this.redis.disconnect();}
}
