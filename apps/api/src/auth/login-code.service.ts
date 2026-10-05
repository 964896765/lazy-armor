import { LocalLoginCodeDeliveryProvider } from './local-login-code-delivery.provider';
import { Injectable, HttpException, UnauthorizedException, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { createHmac, randomInt } from 'node:crypto';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import type { RequestLoginCodeDto, VerifyLoginCodeDto } from './dto';
@Injectable()
export class LoginCodeService implements OnApplicationShutdown {
 private readonly redis: IORedis;
 constructor(private readonly config:ConfigService,private readonly limiter:RateLimiterService,private readonly localDelivery:LocalLoginCodeDeliveryProvider) {
  this.redis=new IORedis(config.getOrThrow<string>('REDIS_URL'),{lazyConnect:true,maxRetriesPerRequest:1});
 }
 normalize(input:RequestLoginCodeDto) {
  const value=input.identifier.trim();
  if(input.kind==='phone') { const phone=value.replace(/^\+86/,''); if(!/^1[3-9]\d{9}$/.test(phone)) throw new HttpException('请输入有效的中国大陆手机号',400); return '+86'+phone; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpException('请输入有效邮箱',400);
  return value.toLowerCase();
 }
 private digest(value:string) {return createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update(value).digest('hex');}
 private key(kind:string,value:string) {return `${this.config.get<string>('REDIS_KEY_PREFIX')??'lazyarmor'}:login-code:${this.digest(kind+':'+value)}`;}
 async request(input:RequestLoginCodeDto,ip:string) {
  const identifier=this.normalize(input);const key=this.key(input.kind,identifier);
  for(const [budget,limit,window] of [[key,1,60],['otp-ip:'+ip,10,600]] as const) if(!(await this.limiter.consume(budget,limit,window)).allowed) throw new HttpException('请稍后再获取验证码',429);
  const endpoint=this.config.get<string>(input.kind==='phone'?'SMS_LOGIN_DELIVERY_ENDPOINT':'EMAIL_LOGIN_DELIVERY_ENDPOINT');
  const token=this.config.get<string>('LOGIN_CODE_DELIVERY_TOKEN');
  let secure=false;try{secure=Boolean(endpoint&&new URL(endpoint).protocol==='https:');}catch{}
  const local=this.localDelivery.available(endpoint);
  if(!local&&(!secure||!endpoint||!token)) throw new HttpException('验证码发送服务暂未开放，请稍后再试',503);
  const code=String(randomInt(0,1000000)).padStart(6,'0');
  await this.redis.set(key,this.digest(key+':'+code),'EX',300);
  if(local){this.localDelivery.deliver(input.kind,identifier,code,new Date(Date.now()+300000));return {sent:true,delivery:'LOCAL_DEVELOPMENT',retryAfterSeconds:60,expiresIn:300};}
  try {const response=await fetch(endpoint!,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({type:'login_code',channel:input.kind,recipient:identifier,code,expiresIn:300}),signal:AbortSignal.timeout(8000)});if(!response.ok) throw new Error('delivery');}
  catch {await this.redis.del(key);throw new HttpException('验证码未能发送，请稍后重试',503);}
  return {sent:true,retryAfterSeconds:60,expiresIn:300};
 }
 async verify(input:VerifyLoginCodeDto,ip:string) {
  const identifier=this.normalize(input);const key=this.key(input.kind,identifier);
  if(!(await this.limiter.consume('otp-verify:'+key,5,300)).allowed||!(await this.limiter.consume('otp-verify-ip:'+ip,30,300)).allowed) throw new HttpException('尝试次数过多，请稍后再试',429);
  const accepted=await this.redis.eval("local v=redis.call('GET',KEYS[1]);if v and v==ARGV[1] then redis.call('DEL',KEYS[1]);return 1 end;return 0",1,key,this.digest(key+':'+input.code));
  if(Number(accepted)!==1) throw new UnauthorizedException('验证码不正确或已过期');
  return identifier;
 }
 async onApplicationShutdown(){if(this.redis.status!=='end')await this.redis.quit();}
}
