import { describe, expect, it, vi } from 'vitest';
vi.mock('ioredis',()=>({default:class { on(){} }}));
import { PhoneBindingService } from '../src/auth/phone-binding.service';

describe('phone binding rollout guard',()=>{
  const make = (enabled:string,unified:boolean,availability='CONFIGURED') => new PhoneBindingService({select:()=>{throw new Error('disabled capability must not read identifiers');}} as never,{get:(key:string)=>key==='AUTH_PHONE_BIND_ENABLED'?enabled:undefined,getOrThrow:()=> 'redis://fixture'} as never,{unified:()=>unified} as never,{availability:()=>availability} as never,{} as never,{} as never);
  it('retains compatibility startup when phone binding is disabled',()=>{expect(()=>make('false',false).onModuleInit()).not.toThrow();});
  it('requires unified credential resolution when enabled',()=>{expect(()=>make('true',false).onModuleInit()).toThrow('UNIFIED');});
  it('accepts the explicit unified rollout',()=>{expect(()=>make('true',true).onModuleInit()).not.toThrow();});
  it.each(['LOCAL_DEVELOPMENT','UNAVAILABLE'])('does not expose phone binding with %s SMS delivery',async availability=>{
    expect(await make('true',true,availability).capabilities({id:'fixture'} as never)).toEqual({phoneBinding:{available:false,sources:[]}});
  });
});
