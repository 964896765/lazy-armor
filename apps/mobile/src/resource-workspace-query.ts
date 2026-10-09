import {NativeModules} from 'react-native';
import {heartbeatDevice} from './device-task-client';
import {useQuery} from '@tanstack/react-query';
import type {ResourceProjection,RuntimeTarget} from '@lazy-armor/plan-schema';
import {api} from './api';
import {useAuthStore} from './auth-store';
import {ensureTrustedDevice,deviceBoundApi} from './trusted-device-api';
import {syncLocalCapabilities} from './local-capability-client';
export function useResourceWorkspace(){const token=useAuthStore(s=>s.token);return useQuery({queryKey:['resource-workspace',token],enabled:Boolean(token),queryFn:async()=>{
 const current=await ensureTrustedDevice(token!);
 const info=await NativeModules.LazyArmorDeviceBridge.runtimeSettings();
 const account=await syncLocalCapabilities(token!);
 await heartbeatDevice(token!);
 const rows=await deviceBoundApi<ResourceProjection[]>('/consumer/resources',token!,{method:'GET'});
 const targets=await api<RuntimeTarget[]>('/runtime-targets',token);
 return {current,account,rows,targets,deviceName:info.deviceName as string};
},refetchInterval:30000});}
