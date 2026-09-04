import { NativeModules, Platform } from 'react-native';
import { supportedDeviceApp } from '@lazy-armor/shared';

interface NativeDetection {
  packageName: string;
  installed: boolean;
  displayName: string | null;
}

interface NativeDeviceBridge {
  detectSupportedApps(packageNames: string[]): Promise<NativeDetection[]>;
  openSupportedApp(packageName: string): Promise<boolean>;
}

export type DeviceAppInstallStatus = 'installed' | 'not_installed' | 'unavailable';
export interface DeviceAppDetection { packageName: string; displayName: string; installStatus: DeviceAppInstallStatus }

function bridge(): NativeDeviceBridge | null {
  if (Platform.OS !== 'android') return null;
  const candidate = NativeModules.LazyArmorDeviceBridge as Partial<NativeDeviceBridge> | undefined;
  if (typeof candidate?.detectSupportedApps !== 'function' || typeof candidate?.openSupportedApp !== 'function') return null;
  return candidate as NativeDeviceBridge;
}

export async function detectSupportedDeviceApps(packageNames: readonly string[]): Promise<DeviceAppDetection[]> {
  const catalog = packageNames.map((packageName) => supportedDeviceApp(packageName)).filter((app): app is NonNullable<typeof app> => Boolean(app));
  const native = bridge();
  if (!native) return catalog.map((app) => ({ packageName: app.packageName, displayName: app.displayName, installStatus: 'unavailable' }));
  try {
    const detected = await native.detectSupportedApps(catalog.map((app) => app.packageName));
    const installed = new Map(detected.map((item) => [item.packageName, item]));
    return catalog.map((app) => ({
      packageName: app.packageName,
      displayName: installed.get(app.packageName)?.displayName ?? app.displayName,
      installStatus: installed.get(app.packageName)?.installed ? 'installed' : 'not_installed',
    }));
  } catch {
    return catalog.map((app) => ({ packageName: app.packageName, displayName: app.displayName, installStatus: 'unavailable' }));
  }
}

export async function openSupportedDeviceApp(packageName: string): Promise<boolean> {
  if (!supportedDeviceApp(packageName)) return false;
  const native = bridge();
  if (!native) return false;
  try {
    return await native.openSupportedApp(packageName);
  } catch {
    return false;
  }
}
