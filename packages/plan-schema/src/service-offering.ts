import {PLAN_DOMAIN_CATALOG} from './product-catalog';
export const SERVICE_DOMAINS=PLAN_DOMAIN_CATALOG.map(({key,label})=>({value:key,label}));
export const SERVICE_DELIVERY_MODES=['ONSITE','AT_LOCATION','REMOTE','LOGISTICS','OTHER'] as const;
export type ServiceDeliveryMode=typeof SERVICE_DELIVERY_MODES[number];
export const SERVICE_PRICE_MODES=['FIXED','STARTING_FROM','NEGOTIABLE','FREE'] as const;
export type ServicePriceMode=typeof SERVICE_PRICE_MODES[number];
export const serviceDeliveryLabels:Record<ServiceDeliveryMode,string>={ONSITE:'上门服务',AT_LOCATION:'到店/到场',REMOTE:'远程服务',LOGISTICS:'寄送/物流',OTHER:'其他'};
export const servicePriceLabels:Record<ServicePriceMode,string>={FIXED:'固定价格',STARTING_FROM:'起价',NEGOTIABLE:'面议',FREE:'免费'};
export interface ServiceFulfillmentInput {
 deliveryMode:string;priceMode?:string;priceMinor?:number|null;serviceArea?:string|null;
 serviceAddress?:string|null;locationInstructions?:string|null;remoteInstructions?:string|null;
 shippingInstructions?:string|null;shippingFeeRules?:string|null;deliveryInstructions?:string|null;bookingInstructions?:string|null;
}
export function canonicalServiceDeliveryMode(value:string):ServiceDeliveryMode|null {return value==='LOCAL'?'ONSITE':SERVICE_DELIVERY_MODES.includes(value as ServiceDeliveryMode)?value as ServiceDeliveryMode:null;}
export function normalizeServiceFulfillment(input:ServiceFulfillmentInput){
 const mode=canonicalServiceDeliveryMode(input.deliveryMode);if(!mode)throw new Error('请选择有效的服务方式');
 const text=(value:string|null|undefined)=>value?.trim()||null;
 const legacy=input.priceMode===undefined;
 const priceMode=input.priceMode??(input.priceMinor==null?'NEGOTIABLE':'STARTING_FROM');
 if(!SERVICE_PRICE_MODES.includes(priceMode as ServicePriceMode))throw new Error('请选择有效的价格方式');
 const paid=priceMode==='FIXED'||priceMode==='STARTING_FROM';
 if(paid&&(input.priceMinor==null||!Number.isSafeInteger(input.priceMinor)||input.priceMinor<0||input.priceMinor>100000000))throw new Error('固定价格和起价需填写有效金额');
 if(!paid&&input.priceMinor!=null)throw new Error('面议或免费不能同时提交金额');
 const fields={deliveryMode:mode,deliveryModes:[mode],priceMode:priceMode as ServicePriceMode,priceMinMinor:paid?input.priceMinor!:null,priceMaxMinor:paid?input.priceMinor!:null,currency:paid?'CNY':null,
 serviceArea:['ONSITE','LOGISTICS'].includes(mode)?text(input.serviceArea):null,
 serviceAddress:mode==='AT_LOCATION'?text(input.serviceAddress):null,locationInstructions:mode==='AT_LOCATION'?text(input.locationInstructions):null,
 remoteInstructions:mode==='REMOTE'?text(input.remoteInstructions)??(legacy?text(input.serviceArea):null):null,
 shippingInstructions:mode==='LOGISTICS'?text(input.shippingInstructions):null,shippingFeeRules:mode==='LOGISTICS'?text(input.shippingFeeRules):null,
 deliveryInstructions:mode==='OTHER'?text(input.deliveryInstructions):null,bookingInstructions:text(input.bookingInstructions)};
 if(mode==='ONSITE'&&!fields.serviceArea)throw new Error('请填写服务区域/覆盖范围');
 if(mode==='AT_LOCATION'&&!fields.serviceAddress)throw new Error('请填写服务地址');
 if(mode==='REMOTE'&&!fields.remoteInstructions)throw new Error('请填写线上交付说明');
 if(mode==='LOGISTICS'&&(!fields.serviceArea||!fields.shippingInstructions||!fields.shippingFeeRules))throw new Error('请填写覆盖区域、寄送说明与运费规则');
 if(mode==='OTHER'&&!fields.deliveryInstructions)throw new Error('请填写服务方式说明');
 return fields;
}
export function servicePriceText(item:{priceMode?:string|null;priceMinMinor:number|null;currency?:string|null}){
 const mode=item.priceMode??(item.priceMinMinor===null?'NEGOTIABLE':'STARTING_FROM');
 if(mode==='FREE')return '免费';if(mode==='NEGOTIABLE')return '面议';
 if(item.priceMinMinor===null)return '价格待确认';
 return `${item.currency==='CNY'||!item.currency?'¥':item.currency+' '}${(item.priceMinMinor/100).toFixed(2)}${mode==='STARTING_FROM'?'起':''}`;
}
