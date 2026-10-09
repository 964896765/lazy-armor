import {describe,it,expect} from 'vitest';
import {canonicalCapabilityId,sameCapabilityIdentity,capabilityIdentity,CAPABILITY_ALIASES,CAPABILITY_IDENTITIES} from '../src/capability-identity';
describe('canonical capability identity',()=>{
 it('resolves explicit legacy aliases while preserving source identity',()=>{for(const key of ['calendar.read','READ_CALENDAR_EVENT','calendar.event.read'])expect(canonicalCapabilityId(key)).toBe('calendar.event.read');expect(capabilityIdentity('FEISHU_DOC_READ')).toMatchObject({canonicalCapabilityId:'document.read',sourceCapabilityKey:'FEISHU_DOC_READ'});});
 it('does not infer unknown aliases or merge read/write and metadata/body',()=>{for(const key of ['JD_READ','Calendar.Read','__proto__','toString'])expect(canonicalCapabilityId(key)).toBeNull();expect(sameCapabilityIdentity('calendar.read','calendar.create')).toBe(false);expect(sameCapabilityIdentity('READ_EMAIL_METADATA','READ_EMAIL_BODY')).toBe(false);});
 it('maps every alias to a declared stable canonical identity',()=>{for(const value of Object.values(CAPABILITY_ALIASES))expect(CAPABILITY_IDENTITIES).toContain(value);});
});
