import {describe,it,expect} from 'vitest';
import {SERVICE_DOMAINS,canonicalServiceDeliveryMode,normalizeServiceFulfillment,servicePriceText} from '../src/service-offering';
describe('ServiceOffering fulfillment and price contract',()=>{
 it('uses the existing 13 domains and does not guess unknown delivery modes',()=>{expect(SERVICE_DOMAINS).toHaveLength(13);expect(canonicalServiceDeliveryMode('LOCAL')).toBe('ONSITE');expect(canonicalServiceDeliveryMode('MYSTERY')).toBeNull();});
 it.each([
  {deliveryMode:'ONSITE',serviceArea:'本市'},
  {deliveryMode:'AT_LOCATION',serviceAddress:'门店地址'},
  {deliveryMode:'REMOTE',remoteInstructions:'视频交付'},
  {deliveryMode:'LOGISTICS',serviceArea:'国内',shippingInstructions:'快递寄送',shippingFeeRules:'到付'},
  {deliveryMode:'OTHER',deliveryInstructions:'双方确认方式'},
 ])('retains only fields relevant to $deliveryMode',input=>{const result=normalizeServiceFulfillment({serviceArea:'旧上门范围',serviceAddress:'旧地址',remoteInstructions:'旧远程说明',shippingInstructions:'旧寄送说明',deliveryInstructions:'旧其它说明',...input,priceMode:'FREE'});expect(result.deliveryModes).toEqual([input.deliveryMode]);if(input.deliveryMode==='REMOTE'){expect(result.serviceArea).toBeNull();expect(result.serviceAddress).toBeNull();}if(input.deliveryMode!=='OTHER')expect(result.deliveryInstructions).toBeNull();});
 it.each(['ONSITE','AT_LOCATION','REMOTE','LOGISTICS','OTHER'])('fails closed for incomplete %s',deliveryMode=>{expect(()=>normalizeServiceFulfillment({deliveryMode,priceMode:'NEGOTIABLE'})).toThrow();});
 it.each(['FIXED','STARTING_FROM'])('requires integer minor units for %s',priceMode=>{for(const priceMinor of [undefined,-1,1.5,Infinity,100000001])expect(()=>normalizeServiceFulfillment({deliveryMode:'REMOTE',remoteInstructions:'线上',priceMode,priceMinor})).toThrow();});
 it.each(['FREE','NEGOTIABLE'])('rejects stale amounts for %s',priceMode=>{expect(()=>normalizeServiceFulfillment({deliveryMode:'REMOTE',remoteInstructions:'线上',priceMode,priceMinor:100})).toThrow();});
 it('keeps legacy remote descriptions and zero-price semantics without guessing FREE',()=>{const result=normalizeServiceFulfillment({deliveryMode:'REMOTE',serviceArea:'旧线上说明',priceMinor:0});expect(result).toMatchObject({remoteInstructions:'旧线上说明',serviceArea:null,priceMode:'STARTING_FROM',priceMinMinor:0});});
 it('renders all four prices distinctly',()=>{expect(servicePriceText({priceMode:'FIXED',priceMinMinor:1250})).toBe('¥12.50');expect(servicePriceText({priceMode:'STARTING_FROM',priceMinMinor:1250})).toBe('¥12.50起');expect(servicePriceText({priceMode:'NEGOTIABLE',priceMinMinor:null})).toBe('面议');expect(servicePriceText({priceMode:'FREE',priceMinMinor:null})).toBe('免费');});
});
