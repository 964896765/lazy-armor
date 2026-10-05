import {describe,it,expect} from 'vitest';
import {appCapabilityAvailability,appProfileVerified,type AppCapabilityEvidence} from '../src/app-resource-capability';
describe('per-app capability authority',()=>{
 const e:AppCapabilityEvidence={installed:true,systemPermission:'GRANTED',userGrant:true,adapterImplemented:true,healthy:true,checkedAt:1000,evidenceRefs:['signed-discovery:1']};
 it('requires each dimension independently',()=>{
  expect(appCapabilityAvailability(e,2000)).toBe('AVAILABLE');
  expect(appCapabilityAvailability({...e,userGrant:false},2000)).toBe('DISABLED');
  expect(appCapabilityAvailability({...e,systemPermission:'DENIED'},2000)).toBe('PERMISSION_REQUIRED');
  for(const property of ['installed','adapterImplemented','healthy'] as const)expect(appCapabilityAvailability({...e,[property]:false},2000)).toBe('UNAVAILABLE');
  expect(appCapabilityAvailability({...e,evidenceRefs:[]},2000)).toBe('UNKNOWN');
  expect(appCapabilityAvailability(e,301001)).toBe('UNKNOWN');
  expect(appCapabilityAvailability({...e,restricted:'UNSUPPORTED'},2000)).toBe('UNSUPPORTED');
 });
 it('never enables a named app profile without parser and phone evidence',()=>{
  expect(appProfileVerified({profileId:'test',packageName:'test.discovered',discoveryEvidenceRef:'discovery:1',modes:['SHARE'],parserVersion:'share-text-v1',phoneEvidenceRefs:[]})).toBe(false);
 });
});
