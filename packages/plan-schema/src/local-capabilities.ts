export const LOCAL_CAPABILITY_CATALOG = [
  {key:'notification.read',name:'通知读取',implemented:true,readable:true},
  {key:'calendar.read',name:'日历',implemented:true,readable:true},
  {key:'contacts.read',name:'通讯录',implemented:true,readable:true},
  {key:'files.read',name:'文件',implemented:true,readable:false},
  {key:'photos.read',name:'相册',implemented:false,readable:false},
  {key:'appusage.read',name:'应用使用情况',implemented:true,readable:true},
  {key:'location.read',name:'位置',implemented:true,readable:true},
  {key:'sms.read',name:'短信',implemented:false,readable:false},
  {key:'share.read',name:'分享接收',implemented:true,readable:false},
  {key:'notification.send',name:'通知发送',implemented:false,readable:false},
  {key:'app.open',name:'打开应用与链接',implemented:false,readable:false},
  {key:'background.task',name:'后台任务',implemented:false,readable:false},
  {key:'appread.session',name:'应用读取会话',implemented:false,readable:false},
  {key:'voice.input',name:'语音输入',implemented:true,readable:false},
  {key:'calendar.create',name:'创建日历事项',implemented:true,readable:false},
  {key:'calendar.update',name:'修改日历事项',implemented:true,readable:false},
  {key:'calendar.delete',name:'删除日历事项',implemented:true,readable:false},
  {key:'media.pick',name:'选择媒体',implemented:false,readable:false},
  {key:'camera.capture',name:'拍摄',implemented:false,readable:false},
  {key:'clipboard.read_on_demand',name:'剪贴板按需读取',implemented:true,readable:false},
  {key:'deep_link.open',name:'打开指定链接',implemented:false,readable:false},
  {key:'network.status',name:'网络状态',implemented:true,readable:true},
  {key:'battery.status',name:'电池状态',implemented:true,readable:true},
  {key:'calllog.read',name:'通话记录',implemented:false,readable:false},
  {key:'location.background',name:'后台位置',implemented:false,readable:false},
  {key:'accessibility.read',name:'无障碍读取',implemented:false,readable:false},
] as const;
export type LocalCapabilityKey = typeof LOCAL_CAPABILITY_CATALOG[number]['key'];
export interface LocalCapabilityEvidence {
 key:string; userGrant:boolean; systemPermission:'GRANTED'|'DENIED'|'ON_DEMAND'|'UNKNOWN'; health:'HEALTHY'|'UNAVAILABLE'|'UNKNOWN'; checkedAt:number;
}
export interface LocalResourceCapability extends LocalCapabilityEvidence {resourceId:string;canonicalKey:string;implemented:boolean;readable:boolean;authority:'NATIVE_OS';evidenceRefs:readonly string[];}
export function localCapabilityAvailability(e:LocalCapabilityEvidence,now:number):'AVAILABLE'|'NOT_IMPLEMENTED'|'DISABLED'|'PERMISSION_REQUIRED'|'UNAVAILABLE'|'UNKNOWN'|'PLATFORM_RESTRICTED'|'SPECIAL_PERMISSION'|'UNSUPPORTED' {
 const restriction=LOCAL_CAPABILITY_RESTRICTIONS[e.key];if(restriction)return restriction;
 const spec=LOCAL_CAPABILITY_CATALOG.find(spec=>spec.key===e.key);
 if(!spec?.implemented)return 'NOT_IMPLEMENTED';
 if(!e.userGrant)return 'DISABLED';
 if(e.systemPermission==='DENIED'||e.systemPermission==='ON_DEMAND')return 'PERMISSION_REQUIRED';
 if(e.health==='UNAVAILABLE')return 'UNAVAILABLE';
 // Match the signed manifest receiver's one-second device clock tolerance.
 if(e.systemPermission!=='GRANTED'||e.health!=='HEALTHY'||e.checkedAt>now+1000||now-e.checkedAt>300000)return 'UNKNOWN';
 return 'AVAILABLE';
}

/** Explicit verified mapping only; catalog names/providers are never used to infer runtime abilities. */
export const LOCAL_RUNTIME_CAPABILITY_MAP: Readonly<Record<string,string>> = {'calendar.read':'READ_CALENDAR_EVENT'};
export function localCapabilitySourceId(deviceId:string,localKey:string):string {
 return `local:${deviceId}:${LOCAL_RUNTIME_CAPABILITY_MAP[localKey]??localKey}`;
}
export function normalizeLocalSourceId(sourceId:string):string {
 for(const [key,runtimeKey] of Object.entries(LOCAL_RUNTIME_CAPABILITY_MAP)){
  if(sourceId.startsWith('local:')&&sourceId.endsWith(':'+key))return sourceId.slice(0,-key.length)+runtimeKey;
 }
 return sourceId;
}

/** Canonical names use existing grants/IDs; aliases never create duplicate resources. */
export const LOCAL_CAPABILITY_CANONICAL_KEYS:Readonly<Record<string,string>>={'files.read':'file.pick/read','photos.read':'media.pick','location.read':'location.foreground','appusage.read':'app.usage.read','share.read':'share.receive','voice.input':'microphone.transcribe','app.open':'app.launch','background.task':'background.device_task'};
export const LOCAL_CAPABILITY_RESTRICTIONS:Readonly<Record<string,'PLATFORM_RESTRICTED'|'SPECIAL_PERMISSION'|'UNSUPPORTED'>>={'sms.read':'PLATFORM_RESTRICTED','calllog.read':'PLATFORM_RESTRICTED','location.background':'SPECIAL_PERMISSION','accessibility.read':'SPECIAL_PERMISSION','notification.send':'UNSUPPORTED'};
export function localCapabilityGroup(key:string):'信息获取'|'设备执行'|'高级能力'{return LOCAL_CAPABILITY_RESTRICTIONS[key]||['background.task','appread.session'].includes(key)?'高级能力':['calendar.create','calendar.update','calendar.delete','app.open','deep_link.open','notification.send','camera.capture'].includes(key)?'设备执行':'信息获取';}
