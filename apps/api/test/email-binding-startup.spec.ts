import { describe, expect, it, vi } from 'vitest';
vi.mock('ioredis',()=>({default:class { on(){} }}));
import { EmailBindingService } from '../src/auth/email-binding.service';

describe('new email binding rollout guard',()=>{
  const make = (enabled:string,unified:boolean) => new EmailBindingService({} as never,{get:(key:string)=>key==='AUTH_EMAIL_BIND_ENABLED'?enabled:undefined,getOrThrow:()=> 'redis://fixture'} as never,{unified:()=>unified} as never,{} as never,{} as never,{} as never);
  it('retains compatibility startup when binding is disabled',()=>{expect(()=>make('false',false).onModuleInit()).not.toThrow();});
  it('refuses enabling new aliases before unified credential resolution',()=>{expect(()=>make('true',false).onModuleInit()).toThrow('UNIFIED');});
  it('accepts the explicit UNIFIED rollout',()=>{expect(()=>make('true',true).onModuleInit()).not.toThrow();});
});
