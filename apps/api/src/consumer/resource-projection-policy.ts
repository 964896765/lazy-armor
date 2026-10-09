/** Product status projection only. Does not confer capability authority. */
export function resourceConnectionStatus(status:string,health:readonly string[]=[]){
 status=status.toLowerCase();
 if(health.some(h=>['REAUTHORIZATION_REQUIRED','REAUTH_REQUIRED'].includes(h)))return '需重新授权';
 if(['expired','reauthorization_required'].includes(status))return '需重新授权';
 if(['revoked','pending_authorization','permission_required'].includes(status))return '需要授权';
 if(status==='config_missing')return '需要配置';
 if(status==='auth_required')return '需要授权';
 if(status==='reauth_required')return '需重新授权';
 if(status==='offline')return '设备离线';
 if(status==='degraded'||health.some(h=>['DEGRADED','RATE_LIMITED'].includes(h)))return '部分可用';
 if(status==='provider_error'||health.some(h=>['UNAVAILABLE','ERROR'].includes(h)))return '异常';
 if(status==='connected')return '已连接';
 return '暂不可用';
}
