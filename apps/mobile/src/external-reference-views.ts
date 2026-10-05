import type {ExternalReferenceDomain,ExternalReferenceKind} from '@lazy-armor/plan-schema/share';
export const referenceKindLabels:Record<ExternalReferenceKind,string>={SERVICE:'服务',PRODUCT:'商品',PLACE:'地点',CONTENT:'内容',DOCUMENT:'文档',EVENT:'事件',OTHER:'其他'};
export const referenceDomainLabels:Record<ExternalReferenceDomain,string>={life:'生活',family:'家庭',travel:'出行',health:'健康',work:'工作',other:'其他'};
export function matchesExternalServiceView(item:{kind:string;domain?:string|null;createdAt?:string},filter:string,now=Date.now()):boolean {
 if(item.kind!=='SERVICE')return false;
 if(filter==='全部')return true;
 if(filter==='最近'){const at=Date.parse(item.createdAt??'');return Number.isFinite(at)&&at<=now&&now-at<=30*86400000;}
 if(filter==='更多')return !['life','family','travel','work'].includes(item.domain??'');
 return referenceDomainLabels[item.domain as ExternalReferenceDomain]===filter;
}
