import {describe,it,expect} from 'vitest';
import {LOCAL_CAPABILITY_CATALOG,localCapabilityAvailability} from '../src/local-capabilities';
describe('local resource authority',()=>{
 const evidence={key:'calendar.read',userGrant:true,systemPermission:'GRANTED' as const,health:'HEALTHY' as const,checkedAt:1000};
 it('requires user grant, OS permission and current health together',()=>{
  expect(localCapabilityAvailability(evidence,2000)).toBe('AVAILABLE');
  expect(localCapabilityAvailability({...evidence,userGrant:false},2000)).toBe('DISABLED');
  expect(localCapabilityAvailability({...evidence,systemPermission:'DENIED'},2000)).toBe('PERMISSION_REQUIRED');
  expect(localCapabilityAvailability({...evidence,health:'UNAVAILABLE'},2000)).toBe('UNAVAILABLE');
  expect(localCapabilityAvailability(evidence,302000)).toBe('UNKNOWN');
 });
 it('accepts bounded device clock skew but rejects future or stale evidence',()=>{
  expect(localCapabilityAvailability({...evidence,checkedAt:2373},2000)).toBe('AVAILABLE');
  expect(localCapabilityAvailability({...evidence,checkedAt:3000},2000)).toBe('AVAILABLE');
  expect(localCapabilityAvailability({...evidence,checkedAt:3001},2000)).toBe('UNKNOWN');
  expect(localCapabilityAvailability({...evidence,checkedAt:1000},301000)).toBe('AVAILABLE');
  expect(localCapabilityAvailability({...evidence,checkedAt:1000},301001)).toBe('UNKNOWN');
 });
 it('never promotes an unsupported adapter using a healthy permission claim',()=>{for(const spec of LOCAL_CAPABILITY_CATALOG.filter(s=>!s.implemented))expect(localCapabilityAvailability({...evidence,key:spec.key},2000)).not.toBe('AVAILABLE');});
 it('cannot enable unimplemented capabilities or grant all files implicitly',()=>{
  expect(localCapabilityAvailability({...evidence,key:'sms.read'},2000)).toBe('PLATFORM_RESTRICTED');
  expect(localCapabilityAvailability({...evidence,key:'files.read',systemPermission:'ON_DEMAND'},2000)).toBe('PERMISSION_REQUIRED');
 });
});
