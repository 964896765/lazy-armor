import { describe,expect,it,vi } from 'vitest';
import { SmsAbuseService } from '../src/auth/sms-abuse.service';
function make(values:Record<string,string>={},missing=false){
 const select=vi.fn(()=>({from:()=>({limit:()=>missing?Promise.reject(new Error('private SQL credentials')):Promise.resolve([])})}));
 const service=new SmsAbuseService({select} as never,{get:(key:string)=>values[key],getOrThrow:()=> 'private'} as never,{} as never);return {service,select};
}
describe('SMS request protection rollout',()=>{
 it('does not require 0096 or read risk records when protection/cleanup are disabled',async()=>{const {service,select}=make({},true);await service.onModuleInit();expect(select).not.toHaveBeenCalled();expect(service.available()).toBe(false);});
 it('requires an independent secret before enabling collection',async()=>{await expect(make({AUTH_SMS_ABUSE_GUARD_ENABLED:'true'}).service.onModuleInit()).rejects.toThrow('independent');});
 it('fails closed and hides underlying SQL details when 0096 is missing',async()=>{const {service}=make({AUTH_SMS_ABUSE_GUARD_ENABLED:'true',SMS_LOGIN_SEND_ENABLED:'true',AUTH_SMS_ABUSE_SECRET:'independent-fixture-secret-xxxxxxxxxxxxxxxxxxx'},true);await expect(service.onModuleInit()).rejects.toMatchObject({response:{code:'SMS_RISK_SERVICE_UNAVAILABLE'}});expect(service.available()).toBe(false);});
 it('supports cleanup-only restart without enabling SMS sending or requiring a risk secret',async()=>{const {service,select}=make({AUTH_SMS_RISK_CLEANUP_ENABLED:'true'});await service.onModuleInit();expect(select).toHaveBeenCalledTimes(2);expect(service.available()).toBe(false);await service.onApplicationShutdown();});
});
