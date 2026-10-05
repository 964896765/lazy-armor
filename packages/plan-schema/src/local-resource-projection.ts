import type { ResourceProjection } from './consumer-projections';
export interface NativeResourceEvidence { acquiredAt:string; acquisition:boolean; notifications:boolean; background:boolean }
/** The native OS is the authority for local permissions. This does not establish remote runtime readiness. */
export function projectLocalResources(evidence:NativeResourceEvidence):ResourceProjection[]{
 return [{key:'acquisition',name:'消息获取',summary:'读取已授权的系统通知'}, {key:'notifications',name:'消息通知',summary:'向本机发送消息提醒'}, {key:'background',name:'后台服务',summary:'允许本机任务在后台运行'}].map(item=>({resourceId:'local:'+item.key,kind:'LOCAL',name:item.name,summary:item.summary,status:evidence[item.key as 'acquisition'|'notifications'|'background']?'已开启':'开启',health:'UNKNOWN',capabilities:[],reasons:[],lastVerifiedAt:evidence.acquiredAt,sourceRef:{type:'NativePermission',id:item.key},primaryAction:{label:'管理授权',path:'/settings'}}));
}
