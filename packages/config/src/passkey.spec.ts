import {describe,expect,it} from 'vitest';
import {parsePasskeyConfig} from './passkey';
const deployed={AUTH_PASSKEY_ENABLED:'true',AUTH_PASSKEY_RP_ID:'app.example.test',AUTH_PASSKEY_ORIGINS:'https://app.example.test',NODE_ENV:'production',APP_ENV:'production'};
describe('Passkey deployment trust',()=>{
  it('is disabled by default without requiring new settings',()=>{expect(parsePasskeyConfig({})).toBeUndefined();});
  it('accepts fixed HTTPS origins without deriving trust from request headers',()=>{expect(parsePasskeyConfig(deployed)).toEqual({rpID:'app.example.test',origins:['https://app.example.test']});});
  it.each(['http://app.example.test','https://attacker.test','https://app.example.test/','https://user:secret@app.example.test','https://*.example.test','https://app.example.test/path'])('rejects untrusted or malformed origin %s',origin=>{expect(()=>parsePasskeyConfig({...deployed,AUTH_PASSKEY_ORIGINS:origin})).toThrow();});
  it('allows localhost only in development/test with development app environment',()=>{const local={AUTH_PASSKEY_ENABLED:'true',AUTH_PASSKEY_RP_ID:'localhost',AUTH_PASSKEY_ORIGINS:'http://localhost:3000',NODE_ENV:'test',APP_ENV:'development'};expect(parsePasskeyConfig(local)?.rpID).toBe('localhost');expect(()=>parsePasskeyConfig({...local,NODE_ENV:'production'})).toThrow();expect(()=>parsePasskeyConfig({...local,APP_ENV:'staging'})).toThrow();expect(()=>parsePasskeyConfig({...local,AUTH_PASSKEY_RP_ID:'127.0.0.1',AUTH_PASSKEY_ORIGINS:'http://127.0.0.1:3000'})).toThrow();});
  it('requires explicit nonempty origins and canonical lowercase RP ID',()=>{expect(()=>parsePasskeyConfig({...deployed,AUTH_PASSKEY_ORIGINS:''})).toThrow();expect(()=>parsePasskeyConfig({...deployed,AUTH_PASSKEY_RP_ID:'APP.example.test'})).toThrow();expect(()=>parsePasskeyConfig({...deployed,AUTH_PASSKEY_ORIGINS:'https://app.example.test,https://app.example.test'})).toThrow();});
});
