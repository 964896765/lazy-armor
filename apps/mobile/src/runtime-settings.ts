import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import { create } from 'zustand';
import { openNotificationAccessSettings, notificationSourceStatus } from './device-app-bridge';
export type RuntimeSettingKey = 'acquisition' | 'notifications' | 'background';
interface RuntimeSettings { acquisition: boolean; notifications: boolean; background: boolean; deviceName?: string }
const bridge = NativeModules.LazyArmorDeviceBridge;
export const useRuntimeSettings = create<RuntimeSettings & { ready: boolean; refresh: () => Promise<void>; toggle: (key: RuntimeSettingKey, value: boolean) => Promise<void> }>((set) => ({ acquisition: false, notifications: false, background: false, ready: false,
 refresh: async () => { if (!bridge?.runtimeSettings) throw new Error('请使用最新 Android 客户端'); set({ ...await bridge.runtimeSettings(), ready: true }); },
 toggle: async (key, value) => { if (!bridge?.setRuntimeSetting) throw new Error('当前客户端不支持此设置'); if (value && key === 'acquisition') { await bridge.setRuntimeSetting(key, false); set({ acquisition: false }); if (!await openNotificationAccessSettings()) throw new Error('无法打开系统通知读取授权'); return; } if (value && key === 'notifications' && Platform.OS === 'android') { if (Number(Platform.Version) >= 33) { const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS); if (result !== PermissionsAndroid.RESULTS.GRANTED) { await bridge.openAppNotificationSettings(); return; } } } await bridge.setRuntimeSetting(key, value); const current = await bridge.runtimeSettings(); set({ ...current, ready: true }); if (value && key === 'notifications' && !current.notifications) await bridge.openAppNotificationSettings(); }
}));
export async function completeAcquisitionAuthorization() { if ((await notificationSourceStatus()).accessGranted) await bridge.setRuntimeSetting('acquisition', true); await useRuntimeSettings.getState().refresh(); }

