export const ACQUISITION_STATES=['VERIFIED_PRESENT','VERIFIED_EMPTY','STALE','UNAVAILABLE','PERMISSION_REQUIRED','OFFLINE','CONFLICT','UNKNOWN'] as const;
export type AcquisitionState=typeof ACQUISITION_STATES[number];
export interface AcquisitionCoverage {sourceId:string;factKey:string;state:AcquisitionState;observedAt:string|null;evidenceRefs:readonly string[];reason:string;}
export interface AcquisitionEvidence {sourceId:string;factKey:string;authorized:boolean;online:boolean;available:boolean;conflict:boolean;readSucceeded:boolean;verified:boolean;itemCount:number|null;observedAt:string|null;maximumAgeSeconds:number;evidenceRefs:readonly string[];}
export function assessAcquisition(e:AcquisitionEvidence,evaluatedAt:string):AcquisitionCoverage {
 let state:AcquisitionState='UNKNOWN';let reason='尚无经过验证的读取证据';
 const now=Date.parse(evaluatedAt),observed=e.observedAt?Date.parse(e.observedAt):NaN;
 if(e.conflict){state='CONFLICT';reason='来源证据存在冲突';}
 else if(!e.authorized){state='PERMISSION_REQUIRED';reason='需要授权此来源';}
 else if(!e.online){state='OFFLINE';reason='来源设备离线';}
 else if(!e.available||!e.readSucceeded){state='UNAVAILABLE';reason='未能读取此来源，不能判断是否有数据';}
 else if(!Number.isFinite(observed)||!Number.isFinite(now)||observed>now){reason='读取时间证据待核实';}
 else if(now-observed>e.maximumAgeSeconds*1000){state='STALE';reason='读取证据已过期';}
 else if(e.verified&&e.evidenceRefs.length&&Number.isSafeInteger(e.itemCount)&&e.itemCount!>=0){state=e.itemCount===0?'VERIFIED_EMPTY':'VERIFIED_PRESENT';reason=e.itemCount===0?'本轮已验证读取结果为空':'本轮已取得真实数据';}
 return {sourceId:e.sourceId,factKey:e.factKey,state,observedAt:e.observedAt,evidenceRefs:e.evidenceRefs,reason};
}
