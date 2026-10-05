import {describe,it,expect} from 'vitest';
import {newServiceOfferingForm,serviceOfferingPayload,offeringToForm} from './service-offering-form-model';
describe('service offering editor model',()=>{
 const form=()=>({...newServiceOfferingForm(),title:'test',summary:'test',serviceType:'repair',contact:'contact',serviceArea:'area'});
 it('converts money exactly and clears hidden amount and delivery fields',()=>{const f={...form(),priceMode:'FIXED' as const,price:'12.34'};expect(serviceOfferingPayload(f).priceMinor).toBe(1234);const changed=serviceOfferingPayload({...f,priceMode:'FREE',deliveryMode:'REMOTE',remoteInstructions:'online'});expect(changed.priceMinor).toBeUndefined();expect(changed.serviceArea).toBeUndefined();});
 it('rejects malformed money and unknown legacy delivery',()=>{for(const price of ['1.234','-1','1e2',''])expect(()=>serviceOfferingPayload({...form(),priceMode:'FIXED',price})).toThrow();expect(offeringToForm({deliveryMode:'UNKNOWN'}).deliveryMode).toBe('');expect(()=>serviceOfferingPayload({...form(),deliveryMode:''})).toThrow();});
 it('keeps explicit zero paid and canonicalizes legacy LOCAL',()=>{expect(serviceOfferingPayload({...form(),priceMode:'STARTING_FROM',price:'0'}).priceMinor).toBe(0);expect(offeringToForm({deliveryMode:'LOCAL',priceMinMinor:0}).priceMode).toBe('STARTING_FROM');expect(offeringToForm({deliveryMode:'LOCAL'}).deliveryMode).toBe('ONSITE');});
});
