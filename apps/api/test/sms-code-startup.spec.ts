import { describe, expect, it } from 'vitest';
import { SmsCodeDeliveryService } from '../src/auth/sms-code-delivery.service';
const values={SMS_LOGIN_SEND_ENABLED:'true',REDIS_KEY_PREFIX:'startup-fixture',SMS_LOGIN_DELIVERY_ENDPOINT:'https://fixture.test',LOGIN_CODE_DELIVERY_TOKEN:'fixture-gateway-token-that-is-longer-than-32',SMS_LOGIN_QUOTA_SECRET:'fixture-quota-secret-that-is-longer-than-32',SMS_LOGIN_TEMPLATE_ID:'fixture-login'};
function make(data:Record<string,string>,readable:boolean) { return new SmsCodeDeliveryService({select:()=>{if(!readable)throw new Error('private-missing-table');return {from:()=>({limit:async()=>[]})};}} as never,{get:(key:string)=>data[key],getOrThrow:(key:string)=>data[key]} as never); }
describe('SMS opt-in migration guard',()=>{
  it('does not query new tables on default disabled legacy deployments',async()=>{const service=make({SMS_LOGIN_SEND_ENABLED:'false'},false);await service.onModuleInit();expect(service.available()).toBe(false);});
  it('rejects incomplete enabled configuration',async()=>{await expect(make({SMS_LOGIN_SEND_ENABLED:'true'},true).onModuleInit()).rejects.toThrow('configuration');});
  it('requires readable 0094 tables when SMS is explicitly enabled',async()=>{await expect(make(values,false).onModuleInit()).rejects.toThrow('0094');});
  it('supports the explicit migrated rollout and immediately rechecks the stop flag',async()=>{const config={...values},service=make(config,true);await service.onModuleInit();expect(service.available()).toBe(true);config.SMS_LOGIN_SEND_ENABLED='false';expect(service.available()).toBe(false);});
});
