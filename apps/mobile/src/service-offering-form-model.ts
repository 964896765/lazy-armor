import {SERVICE_DOMAINS,SERVICE_DELIVERY_MODES,SERVICE_PRICE_MODES,canonicalServiceDeliveryMode,normalizeServiceFulfillment,serviceDeliveryLabels,servicePriceLabels,type ServiceDeliveryMode,type ServicePriceMode} from '@lazy-armor/plan-schema/service-offering';
export interface ServiceOfferingForm {
 title:string;summary:string;domain:string;serviceType:string;deliveryMode:ServiceDeliveryMode|'';
 serviceArea:string;serviceAddress:string;locationInstructions:string;remoteInstructions:string;shippingInstructions:string;shippingFeeRules:string;deliveryInstructions:string;
 priceMode:ServicePriceMode;price:string;contact:string;bookingInstructions:string;
}
export const newServiceOfferingForm=():ServiceOfferingForm=>({title:'',summary:'',domain:'life',serviceType:'',deliveryMode:'ONSITE',serviceArea:'',serviceAddress:'',locationInstructions:'',remoteInstructions:'',shippingInstructions:'',shippingFeeRules:'',deliveryInstructions:'',priceMode:'NEGOTIABLE',price:'',contact:'',bookingInstructions:''});
export function serviceOfferingPayload(form:ServiceOfferingForm){
 if(!form.title.trim()||!form.summary.trim()||!form.serviceType.trim()||!form.contact.trim())throw new Error('请填写服务名称、说明、具体服务类型和联系方式');
 if(!SERVICE_DOMAINS.some(row=>row.value===form.domain))throw new Error('请选择服务领域');
 let priceMinor:number|undefined;
 if(['FIXED','STARTING_FROM'].includes(form.priceMode)){
  if(!/^\d{1,6}(\.\d{1,2})?$/.test(form.price.trim()))throw new Error('请填写有效金额，最多两位小数');
  const [whole,cents='']=form.price.trim().split('.');priceMinor=Number(whole)*100+Number(cents.padEnd(2,'0'));
 }
 const delivery=normalizeServiceFulfillment({...form,priceMinor});
 return {title:form.title.trim(),summary:form.summary.trim(),domain:form.domain,serviceType:form.serviceType.trim(),contact:form.contact.trim(),deliveryMode:delivery.deliveryMode,priceMode:delivery.priceMode,priceMinor,
 serviceArea:delivery.serviceArea??undefined,serviceAddress:delivery.serviceAddress??undefined,locationInstructions:delivery.locationInstructions??undefined,remoteInstructions:delivery.remoteInstructions??undefined,shippingInstructions:delivery.shippingInstructions??undefined,shippingFeeRules:delivery.shippingFeeRules??undefined,deliveryInstructions:delivery.deliveryInstructions??undefined,bookingInstructions:delivery.bookingInstructions??undefined};
}
export function offeringToForm(item:Record<string,unknown>):ServiceOfferingForm {
 const base=newServiceOfferingForm();for(const key of Object.keys(base) as Array<keyof ServiceOfferingForm>)if(typeof item[key]==='string')(base as unknown as Record<string,string>)[key]=item[key] as string;
 base.deliveryMode=canonicalServiceDeliveryMode(String(item.deliveryMode))??'';
 base.priceMode=SERVICE_PRICE_MODES.includes(item.priceMode as ServicePriceMode)?item.priceMode as ServicePriceMode:item.priceMinMinor==null?'NEGOTIABLE':'STARTING_FROM';
 base.price=typeof item.priceMinMinor==='number'?(item.priceMinMinor/100).toFixed(2):'';
 return base;
}
