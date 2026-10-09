import {describe,expect,it} from 'vitest';
import type {ResourceProjection,RuntimeTarget} from '@lazy-armor/plan-schema';
import {appCapabilityLabel,localCapabilitySection,contextualAdd,currentLocalCapabilities,persistentGrantToggle,resourceStatus,targetPartition,workspaceState} from './resource-workspace';
const target=(id:string,type:RuntimeTarget['targetType'],backing:string)=>({targetId:id,targetType:type,ownerScope:'owner',accountScope:null,authorityEpoch:1,onlineState:'UNKNOWN',health:'UNKNOWN',lastSeenAt:null,manifestVersion:'test-only',manifestHash:'a'.repeat(64),metadata:{backingRef:backing}} as RuntimeTarget);
const local=(device:string,key='calendar.read')=>({resourceId:`local:${device}:${key}`,kind:'LOCAL',sourceRef:{type:'LocalCapability',id:key},capabilityState:{key}} as ResourceProjection);
describe('resource workspace identity and capability contracts',()=>{
 it('isolates the current Android target by signed backing identity, not name or list position',()=>{
  const targets=[target('other','ANDROID_DEVICE','other-device'),target('provider','PROVIDER','same'),target('current','ANDROID_DEVICE','same'),target('windows','WINDOWS_DEVICE','win')];
  expect(targetPartition(targets,'same').current?.targetId).toBe('current');
  expect(targetPartition(targets,'same').other.map(t=>t.targetId)).toEqual(['other','windows']);
 });
 it('does not classify an unidentified target as this phone and keeps cloud/MCP out of other devices',()=>{
  const partition=targetPartition([target('mcp','MCP_SERVER','mcp'),target('provider','PROVIDER','p')],'unproved');
  expect(partition.current).toBeUndefined();expect(partition.other).toEqual([]);
 });
 it('fails closed for missing target identity and excludes historical headers for the same installation',()=>{
  const missing={...target('unknown','ANDROID_DEVICE','old'),metadata:{}};
  const old={...target('old','ANDROID_DEVICE','old'),metadata:{backingRef:'old',deviceId:'installation'}};
  expect(targetPartition([missing,old,target('current','ANDROID_DEVICE','current')],'current','installation').other).toEqual([]);
 });
 it('excludes other phone capabilities, ExternalReference and Artifact even with spoofed LOCAL kind',()=>{
  const reference={...local('current'),sourceRef:{type:'ExternalReference',id:'ref'}} as ResourceProjection;
  const artifact={...local('current'),sourceRef:{type:'Artifact',id:'file'}} as ResourceProjection;
  expect(currentLocalCapabilities([local('current'),local('other'),reference,artifact],'current')).toEqual([local('current')]);
 });
 it.each(['files.read','media.pick','photos.read','camera.capture','clipboard.read_on_demand'])('no persistent toggle for per-use %s',key=>expect(persistentGrantToggle(key,'GRANTED')).toBe(false));
 it('system ON_DEMAND is never turned into a persistent grant toggle',()=>{expect(persistentGrantToggle('future.pick','ON_DEMAND')).toBe(false);expect(persistentGrantToggle('calendar.read','DENIED')).toBe(true);});
 it.each([['CONNECTED','已连接'],['CONFIG_MISSING','需要配置'],['AUTH_REQUIRED','需要授权'],['REAUTH_REQUIRED','需重新授权'],['DEGRADED','部分可用'],['OFFLINE','设备离线'],['UNAVAILABLE','暂不可用'],['PLATFORM_RESTRICTED','平台受限'],['UNSUPPORTED','暂不支持']])('maps %s distinctly', (state,label)=>expect(resourceStatus(state)).toBe(label));
 it('keeps execution capabilities in execution even when currently unsupported',()=>{expect(localCapabilitySection('notification.send')).toBe('设备执行');expect(localCapabilitySection('background.task')).toBe('设备执行');expect(localCapabilitySection('appread.session')).toBe('应用能力');expect(localCapabilitySection('share.read')).toBe('信息获取');});
 it('discovery never enables enhanced capability and removed installation fences an available snapshot',()=>{expect(appCapabilityLabel('UNAVAILABLE',true)).toBe('暂不可用');expect(appCapabilityLabel('UNSUPPORTED',true)).toBe('暂不支持');expect(appCapabilityLabel('AVAILABLE',false)).toBe('暂不可用');});
 it('uses separate contextual routes, never the legacy three-way connection entry',()=>{expect(Object.values(contextualAdd).map(a=>a.path)).toEqual(['/add-phone-app','/add-cloud-resource','/pair-device','/add-interface']);});
 it('preserves loading, error, empty and offline instead of treating them as verified empty',()=>{expect(workspaceState(true,false,0)).toBe('loading');expect(workspaceState(false,true,0)).toBe('error');expect(workspaceState(false,false,0)).toBe('empty');expect(workspaceState(false,false,2,'OFFLINE')).toBe('offline');});
});
