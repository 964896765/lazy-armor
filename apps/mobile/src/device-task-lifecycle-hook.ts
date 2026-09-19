import { AppState } from 'react-native';
import { useEffect } from 'react';
import { executeStructuredRead } from './android-structured-read-executor';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { DeviceTaskRunner, secureRunnerStateStore } from './device-task-runner';
import { DeviceTaskRunnerLifecycle } from './device-task-lifecycle';
import { ensureTrustedDevice } from './trusted-device-api';

async function assertDeviceTaskRunnerReady(token: string): Promise<boolean> {
  try {
    await ensureTrustedDevice(token);
    const connections = await api<Array<{ enabled: boolean }>>('/device-app-connections', token);
    return connections.some((connection) => connection.enabled === true);
  } catch {
    return false;
  }
}

const runner = new DeviceTaskRunner({
  token: () => useAuthStore.getState().token ?? null,
  state: secureRunnerStateStore,
  executeStructuredRead,
});

const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: assertDeviceTaskRunnerReady });

export function useDeviceTaskRunnerLifecycle() {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    const current = token ?? null;
    void lifecycle.sync(current);
    const subscription = AppState.addEventListener('change', (state) => {
      lifecycle.onAppState(state === 'active');
    });
    // Foreground re-check catches server-side device revoke / authorization loss
    // without requiring a background service.
    const recheck = setInterval(() => {
      if (AppState.currentState === 'active') void lifecycle.sync(useAuthStore.getState().token ?? null);
    }, 30_000);
    return () => {
      clearInterval(recheck);
      subscription.remove();
      lifecycle.stop();
    };
  }, [token, hydrated]);
}
