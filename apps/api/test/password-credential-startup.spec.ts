import { describe,expect,it,vi } from 'vitest';
import { PasswordCredentialService } from '../src/auth/password-credential.service';

describe('password migration startup guard',()=>{
 it('keeps legacy startup available before the new table is installed',async()=>{
  const select=vi.fn();
  const service=new PasswordCredentialService({select} as never,{get:()=> 'LEGACY'} as never,{} as never);
  await service.onModuleInit();expect(select).not.toHaveBeenCalled();
 });
 it.each(['SHADOW','UNIFIED'])('refuses %s startup when the new schema is unavailable without exposing SQL errors',async mode=>{
  const databaseError=new Error('private query details');
  const limit=vi.fn().mockRejectedValue(databaseError);
  const service=new PasswordCredentialService({select:()=>({from:()=>({limit})})} as never,{get:()=>mode} as never,{} as never);
  await expect(service.onModuleInit()).rejects.toThrow('Apply migration 0093');
 });
});
