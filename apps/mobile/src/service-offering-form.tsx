import {SERVICE_DOMAINS,SERVICE_DELIVERY_MODES,SERVICE_PRICE_MODES,canonicalServiceDeliveryMode,normalizeServiceFulfillment,serviceDeliveryLabels,servicePriceLabels,type ServiceDeliveryMode,type ServicePriceMode} from '@lazy-armor/plan-schema/service-offering';
import type {ReactNode} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Field,ui} from './editor-ui';
import {type ServiceOfferingForm} from './service-offering-form-model';
export {type ServiceOfferingForm,newServiceOfferingForm,serviceOfferingPayload,offeringToForm} from './service-offering-form-model';
function Section({title,children}:{title:string;children:ReactNode}){return <View style={{gap:8,paddingTop:12,marginTop:6,borderTopWidth:1,borderTopColor:'#E3E8EF'}}><Text style={ui.title}>{title}</Text>{children}</View>;}
export function ServiceOfferingFields({value,onChange,imageFields}:{value:ServiceOfferingForm;onChange:(value:ServiceOfferingForm)=>void;imageFields?:ReactNode}){
 const change=(key:keyof ServiceOfferingForm,text:string)=>onChange({...value,[key]:text});
 const field=(key:keyof ServiceOfferingForm,label:string,max=600,placeholder?:string)=><Field key={key} label={label} value={value[key]} onChange={text=>change(key,text)} max={max} placeholder={placeholder}/>;
 return <>
 <Section title="基础信息">{field('title','服务名称',160)}<Field label="服务说明" value={value.summary} onChange={text=>change('summary',text)} max={600} multiline/>{imageFields}</Section>
 <Section title="服务信息">{field('serviceType','具体服务类型',40,'例如：家电维修、课程辅导、物流运输')}<Text style={ui.label}>领域</Text><View style={[ui.line,{flexWrap:'wrap'}]}>{SERVICE_DOMAINS.map(row=><Pressable key={row.value} onPress={()=>change('domain',row.value)} style={[ui.pill,value.domain===row.value&&{backgroundColor:'#BDD9FF'}]}><Text>{row.label}</Text></Pressable>)}</View>{!SERVICE_DOMAINS.some(row=>row.value===value.domain)?<Text style={ui.detail}>原领域未纳入当前目录，请重新选择。</Text>:null}<Text style={ui.label}>服务方式</Text><View style={[ui.line,{flexWrap:'wrap'}]}>{SERVICE_DELIVERY_MODES.map(mode=><Pressable key={mode} onPress={()=>change('deliveryMode',mode)} style={[ui.pill,value.deliveryMode===mode&&{backgroundColor:'#BDD9FF'}]}><Text>{serviceDeliveryLabels[mode]}</Text></Pressable>)}</View>{!value.deliveryMode?<Text style={ui.detail}>原服务方式无法确定，请明确选择。</Text>:null}</Section>
 <Section title="交付信息">
 {value.deliveryMode==='ONSITE'?field('serviceArea','服务区域/覆盖范围',300):null}
 {value.deliveryMode==='AT_LOCATION'?<>{field('serviceAddress','服务地址')}{field('locationInstructions','到店/到场说明（选填）')}</>:null}
 {value.deliveryMode==='REMOTE'?field('remoteInstructions','线上交付说明'):null}
 {value.deliveryMode==='LOGISTICS'?<>{field('serviceArea','覆盖区域',300)}{field('shippingInstructions','寄送说明')}{field('shippingFeeRules','运费规则')}</>:null}
 {value.deliveryMode==='OTHER'?field('deliveryInstructions','服务方式说明（必填）'):null}
 </Section>
 <Section title="价格"><View style={[ui.line,{flexWrap:'wrap'}]}>{SERVICE_PRICE_MODES.map(mode=><Pressable key={mode} onPress={()=>change('priceMode',mode)} style={[ui.pill,value.priceMode===mode&&{backgroundColor:'#BDD9FF'}]}><Text>{servicePriceLabels[mode]}</Text></Pressable>)}</View>{['FIXED','STARTING_FROM'].includes(value.priceMode)?field('price',value.priceMode==='FIXED'?'金额（元）':'起价金额（元）',10):<Text style={ui.detail}>{servicePriceLabels[value.priceMode]}</Text>}</Section>
 <Section title="联系与预约">{field('contact','公开联系方式',160)}{field('bookingInstructions','预约说明（选填）')}</Section>
 </>;
}
