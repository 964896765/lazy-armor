import { NativeModules, Platform } from 'react-native';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { syncLocalCapabilities } from './local-capability-client';
import { executeStructuredRead } from './android-structured-read-executor';
import type { DeviceTask } from './device-task-client';
import type { StructuredReadResult } from './device-task-runner';
/** Existing runner dispatch only: permissions are never requested from an automatic task. */
export async function executeDeviceTask(task:DeviceTask):Promise<StructuredReadResult>{
 if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(task.taskType)){
  const token=useAuthStore.getState().token;
  if(!token||Platform.OS!=='android'||!task.dispatchAuthorization||!['CLAIMED','RUNNING'].includes(task.status)||!task.claimToken||!NativeModules.LazyArmorDeviceBridge?.executeClaimedRuntimeTask)return null;
  const user=await api<{id:string}>('/me',token);
  if(useAuthStore.getState().token!==token)return null;
  const raw=await NativeModules.LazyArmorDeviceBridge.executeClaimedRuntimeTask(user.id,JSON.stringify(task));
  return typeof raw==='string'?JSON.parse(raw):raw;
 }
 if(!['NATIVE_CALENDAR_READ','NATIVE_NOTIFICATION_READ'].includes(task.taskType))return executeStructuredRead(task);
 const token=useAuthStore.getState().token;
 if(!token||Platform.OS!=='android'||!NativeModules.LazyArmorDeviceBridge?.acquireLocalResource)return null;
 const {scopeStart,scopeEnd}=task.payload;
 if(typeof scopeStart!=='number'||typeof scopeEnd!=='number'||!Number.isFinite(scopeStart)||!Number.isFinite(scopeEnd)||scopeStart>=scopeEnd||scopeEnd-scopeStart>31*86400000)return null;
 const user=await api<{id:string}>('/me',token);
 await syncLocalCapabilities(token);
 if(useAuthStore.getState().token!==token)return null;
 const notification=task.taskType==='NATIVE_NOTIFICATION_READ';
 if(notification && (typeof task.payload.sourcePackage!=='string' || !NativeModules.LazyArmorDeviceBridge.acquireNotificationSource))return null;
 const raw=notification?await NativeModules.LazyArmorDeviceBridge.acquireNotificationSource(user.id,task.payload.sourcePackage,scopeStart,scopeEnd):await NativeModules.LazyArmorDeviceBridge.acquireLocalResource(user.id,'calendar.read',scopeStart,scopeEnd);
 const receipt=typeof raw==='string'?JSON.parse(raw):raw;
 if(!receipt||typeof receipt!=='object'||receipt.capability!==(notification?'notification.read':'calendar.read')||receipt.manifestVersion!=='android-local-v1')throw new Error('本机读取证据格式无效');
 return receipt;
}
