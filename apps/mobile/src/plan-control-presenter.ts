export interface PlanControlProjection {
 state:'AVAILABLE'|'NOT_CONFIGURED';planVersionId?:string;goalDescription?:string;
 origin?:{label:string;detail:string;skillVersion:null};
 informationState?:string;
 information:Array<{factKey:string;label:string;sourceLabel:string;state:string;verified:boolean;observedAt:string|null;truthVersionId:string|null;itemCount:number|null;maximumAgeSeconds:number}>;
 resources:Array<{capabilityId:string;targetId:string;name:string;health:string;onlineState:string;lastUsedAt:string;executionId:string|null;verificationState:string}>;
 records:Array<{id:string;planVersionId:string;status:string;createdAt:string;resultSummary:string|null;verificationState:string;capabilityIds:string[]}>;
 resourcePolicy?:string;manualRunAllowed?:boolean;manualRunReason?:string;
}
const capabilities:Record<string,string>={'calendar.event.read':'读取日历','calendar.event.create':'创建日历事项','calendar.event.update':'修改日历事项','email.send':'发送邮件','content.publish':'发布内容','service.booking.request':'提交服务预约'};
export function controlActionLabel(capability:string|undefined,legacyLabel='按计划处理'):string{return capability&&capabilities[capability]||legacyLabel;}
export function controlTitle(name:string,capability?:string,scheduled=false):string{
 if(name.length<=24)return name;
 if(capability==='calendar.event.create')return scheduled?'定时创建日历事项':'创建日历事项';
 return name.slice(0,22)+'…';
}
export function controlResultLabel(record:PlanControlProjection['records'][number]):string{
 if(record.verificationState==='OUTCOME_UNKNOWN')return '结果待确认，正在核对，暂不会重复执行';
 if(record.verificationState==='VERIFIED'&&record.status==='succeeded')return record.capabilityIds.includes('calendar.event.create')?'日历事项已创建并核对':'本次结果已验证';
 if(record.status==='succeeded')return '本次处理已完成';
 return ({waiting_approval:'等待你的确认',running:'正在处理',failed:'本次未完成',cancelled:'本次已取消',partially_succeeded:'部分完成'} as Record<string,string>)[record.status]??'等待处理';
}
export function controlVerificationLabel(state:string):string{return ({VERIFIED:'已验证',OUTCOME_UNKNOWN:'结果待确认',NOT_VERIFIED:'尚未核实'} as Record<string,string>)[state]??'尚未核实';}
export function informationStatus(info:PlanControlProjection['information'][number]):string{
 if(info.state==='STALE')return '已验证，数据可能已过期';
 if(info.state==='CONFLICT')return '信息有冲突，需核对';
 const sourceIssue=({NEEDS_PERMISSION:'需要授权',DEVICE_OFFLINE:'设备离线',PROVIDER_UNHEALTHY:'来源异常',SOURCE_NOT_IMPLEMENTED:'来源待接入',NEEDS_SOURCE:'需要补充来源'} as Record<string,string>)[info.state];
 if(sourceIssue)return (info.verified?'历史信息已验证 · ':'')+sourceIssue;
 return info.verified?'已验证':({NEEDS_PERMISSION:'需要授权',DEVICE_OFFLINE:'设备离线',UNKNOWN:'尚未核实'} as Record<string,string>)[info.state]??'需要更新';
}
