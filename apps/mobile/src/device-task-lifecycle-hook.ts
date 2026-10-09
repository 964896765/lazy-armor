import {syncRuntimeResults} from './runtime-result-client';
import { useRuntimeSettings } from './runtime-settings';
import { AppState,NativeModules } from 'react-native';
import { useEffect } from 'react';
import { executeDeviceTask } from './android-device-task-executor';
import {syncLocalCapabilities} from './local-capability-client';
import {deviceBoundApi} from './trusted-device-api';
import type {ResourceProjection} from '@lazy-armor/plan-schema';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { DeviceTaskRunner, secureRunnerStateStore } from './device-task-runner';
import { DeviceTaskRunnerLifecycle } from './device-task-lifecycle';
import { ensureTrustedDevice } from './trusted-device-api';

async function assertDeviceTaskRunnerReady(token: string): Promise<boolean> {
  try {
    await useRuntimeSettings.getState().refresh();
    await ensureTrustedDevice(token);
    await syncLocalCapabilities(token);
    const resources=await deviceBoundApi<ResourceProjection[]>('/consumer/resources',token,{method:'GET'});
    if(resources.some(row=>row.kind==='LOCAL'&&['calendar.read','calendar.create','calendar.update','calendar.delete'].includes(row.capabilityState?.key??'')&&row.capabilityState?.availability==='AVAILABLE'))return true;
    if (!useRuntimeSettings.getState().background) return false;
    const connections = await api<Array<{ enabled: boolean }>>('/device-app-connections', token);
    return connections.some((connection) => connection.enabled === true);
  } catch {
    return false;
  }
}

const runner = new DeviceTaskRunner({
  token: () => useAuthStore.getState().token ?? null,
  state: secureRunnerStateStore,
  executeStructuredRead:executeDeviceTask,
});

const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: assertDeviceTaskRunnerReady });

export function useDeviceTaskRunnerLifecycle() {
  const background = useRuntimeSettings(state => state.background);
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    const current = token ?? null;
    if(!current)void NativeModules.LazyArmorDeviceBridge?.clearLocalCapabilityAccount?.();
    void lifecycle.sync(current);
    if(current&&AppState.currentState==='active')void syncRuntimeResults().catch(()=>{});
    const subscription = AppState.addEventListener('change', (state) => {
      lifecycle.onAppState(state === 'active');
      if(state==='active')void syncRuntimeResults().catch(()=>{});
    });
    // Foreground re-check catches server-side device revoke / authorization loss
    // without requiring a background service.
    const recheck = setInterval(() => {
      if (AppState.currentState === 'active'){void lifecycle.sync(useAuthStore.getState().token ?? null);void syncRuntimeResults().catch(()=>{});}
    }, 30_000);
    return () => {
      clearInterval(recheck);
      subscription.remove();
      lifecycle.stop();
    };
  }, [token, hydrated, background]);
}
