import { NativeModules, Platform } from 'react-native';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { syncLocalCapabilities } from './local-capability-client';
import { executeStructuredRead } from './android-structured-read-executor';
import type { DeviceTask } from './device-task-client';
import type { StructuredReadResult } from './device-task-runner';
/** Existing runner dispatch only: permissions are never requested from an automatic task. */
export async function executeDeviceTask(task:DeviceTask):Promise<StructuredReadResult>{
 if(task.taskType!=='NATIVE_CALENDAR_READ')return executeStructuredRead(task);
 const token=useAuthStore.getState().token;
 if(!token||Platform.OS!=='android'||!NativeModules.LazyArmorDeviceBridge?.acquireLocalResource)return null;
 const {scopeStart,scopeEnd}=task.payload;
 if(typeof scopeStart!=='number'||typeof scopeEnd!=='number'||!Number.isFinite(scopeStart)||!Number.isFinite(scopeEnd)||scopeStart>=scopeEnd||scopeEnd-scopeStart>31*86400000)return null;
 const user=await api<{id:string}>('/me',token);
 await syncLocalCapabilities(token);
 if(useAuthStore.getState().token!==token)return null;
 const raw=await NativeModules.LazyArmorDeviceBridge.acquireLocalResource(user.id,'calendar.read',scopeStart,scopeEnd);
 const receipt=typeof raw==='string'?JSON.parse(raw):raw;
 if(!receipt||typeof receipt!=='object'||receipt.capability!=='calendar.read'||receipt.manifestVersion!=='android-local-v1')throw new Error('本机读取证据格式无效');
 return receipt;
}
