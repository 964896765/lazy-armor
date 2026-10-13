import { describe,expect,it } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { decodeRecoveryToken,encodeRecoveryToken,recoveryTokenHash } from '../src/auth/password-recovery-token';
import { PasswordRecoveryService } from '../src/auth/password-recovery.service';

describe('opaque channel-bound recovery token',()=>{
  const secret='recovery-fixture-secret-longer-than-thirty-two-characters';
  const context=()=>({userId:randomUUID(),source:{kind:'identifier' as const,id:randomUUID(),epoch:'a'.repeat(64)},passwordEpoch:'b'.repeat(64),expiresAt:Date.now()+600000});
  it('encrypts identity and fingerprints and authenticates a compact versioned context',()=>{
    const value=context(),raw=encodeRecoveryToken(secret,value);
    expect(raw.length).toBeLessThan(1024); expect(raw.startsWith('v2.')).toBe(true);
    expect(raw).not.toContain(value.userId);expect(raw).not.toContain(value.source.id);expect(raw).not.toContain(value.passwordEpoch);
    expect(decodeRecoveryToken(secret,raw)).toMatchObject({...value,version:2});
  });
  it('gives identical requests independent unpredictable ciphertexts and nonces',()=>{
    const value=context(),a=encodeRecoveryToken(secret,value),b=encodeRecoveryToken(secret,value);
    expect(a).not.toBe(b);expect(decodeRecoveryToken(secret,a).nonce).not.toBe(decodeRecoveryToken(secret,b).nonce);
  });
  it('fails closed on key rotation',()=>{const raw=encodeRecoveryToken(secret,context());expect(()=>decodeRecoveryToken(secret+'rotated',raw)).toThrow('Invalid recovery token');});
  it('separates the SQL lookup from legacy hashing and from a rotated key',()=>{
    const raw=encodeRecoveryToken(secret,context()),modern=recoveryTokenHash(secret,raw);
    expect(modern).toMatch(/^[a-f0-9]{64}$/);expect(modern).not.toBe(createHash('sha256').update(raw).digest('hex'));expect(modern).not.toBe(recoveryTokenHash(secret+'rotated',raw));
  });
  it.each([0,1,2,3])('rejects tampering in token segment %s',index=>{
    const parts=encodeRecoveryToken(secret,context()).split('.');parts[index]=(parts[index][0]==='A'?'B':'A')+parts[index].slice(1);
    expect(()=>decodeRecoveryToken(secret,parts.join('.'))).toThrow('Invalid recovery token');
  });
  it.each(['a'.repeat(64),'v2.a.b.c','v2.'+'a'.repeat(1025),'v2.a.b.c.extra'])('rejects a malformed or old bearer without revealing it',raw=>{
    expect(()=>decodeRecoveryToken(secret,raw)).toThrow('Invalid recovery token');
  });
});
describe('recovery rollout startup guard',()=>{
  const make=(mode:string,unified:boolean)=>new PasswordRecoveryService({} as never,{get:()=>mode} as never,{unified:()=>unified} as never,{} as never,{} as never,{} as never);
  it('retains compatibility startup before migration and unified rollout',()=>{expect(()=>make('LEGACY',false).onModuleInit()).not.toThrow();});
  it('requires unified credential ownership before alias recovery',()=>{expect(()=>make('BOUND',false).onModuleInit()).toThrow('UNIFIED');});
  it('accepts the explicit bound rollout',()=>{expect(()=>make('BOUND',true).onModuleInit()).not.toThrow();});
});
