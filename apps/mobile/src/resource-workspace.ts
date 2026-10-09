import {LOCAL_CAPABILITY_CATALOG} from '@lazy-armor/plan-schema/local-capabilities';
import type {ResourceProjection,RuntimeTarget} from '@lazy-armor/plan-schema';
export const resourceTabs=[{value:'LOCAL',label:'本机'},{value:'CLOUD',label:'云端'},{value:'DEVICE',label:'其它设备'},{value:'INTERFACE',label:'接口'}] as const;
export type ResourceTab=typeof resourceTabs[number]['value'];
export const contextualAdd={LOCAL:{label:'添加手机应用',path:'/add-phone-app'},CLOUD:{label:'添加云端资源',path:'/add-cloud-resource'},DEVICE:{label:'配对设备',path:'/pair-device'},INTERFACE:{label:'添加接口',path:'/add-interface'}} as const;
export function targetPartition(targets:readonly RuntimeTarget[],trustedDeviceId:string,installationId?:string){
 const current=targets.find(t=>t.targetType==='ANDROID_DEVICE'&&t.metadata.backingRef===trustedDeviceId);
 const deviceTypes=new Set(['ANDROID_DEVICE','WINDOWS_DEVICE','MAC_DEVICE','IOS_DEVICE','BROWSER_NODE','EDGE_NODE','NAS','REMOTE_BROWSER']);
 return {current,other:targets.filter(t=>deviceTypes.has(t.targetType)&&typeof t.metadata.backingRef==='string'&&(!installationId||t.metadata.deviceId!==installationId)&&t.metadata.backingRef!==trustedDeviceId&&t.targetId!==current?.targetId)};
}
export function currentLocalCapabilities(rows:readonly ResourceProjection[],trustedDeviceId:string){return rows.filter(r=>r.kind==='LOCAL'&&r.sourceRef.type==='LocalCapability'&&r.resourceId.startsWith(`local:${trustedDeviceId}:`)&&r.capabilityState&&r.capabilityState.key!=='photos.read').sort((a,b)=>LOCAL_CAPABILITY_CATALOG.findIndex(c=>c.key===a.capabilityState!.key)-LOCAL_CAPABILITY_CATALOG.findIndex(c=>c.key===b.capabilityState!.key));}
export function persistentGrantToggle(key:string,permission:string){return !['files.read','photos.read','media.pick','camera.capture','clipboard.read_on_demand'].includes(key)&&permission!=='ON_DEMAND';}
export function resourceStatus(status:string){return ({CONNECTED:'已连接',CONFIG_MISSING:'需要配置',AUTH_REQUIRED:'需要授权',REAUTH_REQUIRED:'需重新授权',DEGRADED:'部分可用',OFFLINE:'设备离线',UNAVAILABLE:'暂不可用',AVAILABLE:'可用',GRANTED:'已授权',ON_DEMAND:'按次授权',NOT_IMPLEMENTED:'待接入',PLATFORM_RESTRICTED:'平台受限',SPECIAL_PERMISSION:'需要授权',UNSUPPORTED:'暂不支持',UNKNOWN:'待检查',DISABLED:'需要授权',PERMISSION_REQUIRED:'需要授权',HEALTHY:'正常',DENIED:'需要授权'})[status]??status;}
export function localStatus(row:ResourceProjection){const s=row.capabilityState!;if(!s.implemented)return resourceStatus(s.availability);if(!persistentGrantToggle(s.key,s.systemPermission))return '按次授权';return resourceStatus(s.availability);}
export function workspaceState(loading:boolean,error:boolean,count:number,online?:string){return loading?'loading':error?'error':online==='OFFLINE'?'offline':count?'ready':'empty';}

export function appCapabilityLabel(status:string,currentlyInstalled:boolean){return status==='AVAILABLE'&&!currentlyInstalled?'暂不可用':resourceStatus(status);}

export function targetLabel(target:RuntimeTarget){const names:Record<string,string>={ANDROID_DEVICE:'安卓设备',WINDOWS_DEVICE:'Windows 设备',IOS_DEVICE:'iPhone / iPad',REMOTE_BROWSER:'浏览器节点',MCP_SERVER:'MCP Server',CLOUD_WORKSPACE:'云端运行节点'};if(typeof target.metadata.displayName==='string')return target.metadata.displayName;const tail=typeof target.metadata.deviceId==='string'?target.metadata.deviceId.slice(-6):null;return (names[target.targetType]??'设备')+(tail?` · ${tail}`:'');}

export function localCapabilitySection(key:string):'信息获取'|'设备执行'|'应用能力'{return key==='appread.session'?'应用能力':['notification.send','calendar.create','calendar.update','calendar.delete','app.open','deep_link.open','background.task','camera.capture'].includes(key)?'设备执行':'信息获取';}
