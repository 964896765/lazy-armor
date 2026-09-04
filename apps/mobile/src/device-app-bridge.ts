import { NativeModules, Platform } from 'react-native';

export interface DiscoveredDeviceApp {
  packageName: string;
  displayName: string;
  versionName: string | null;
  versionCode: number | null;
  launchable: boolean;
  iconDataUri: string | null;
  discoveryFingerprint: string;
}

export interface NotificationSourceStatus {
  accessGranted: boolean;
  enabledPackageCount: number;
  pendingCount: number;
}

export interface MobileNotificationPreview {
  eventId: string;
  contentHash: string;
  sourcePackage: string;
  postedAt: number;
  capturedAt: number;
  hasTitle: boolean;
  hasText: boolean;
}

interface NativeDeviceBridge {
  discoverLaunchableApps(): Promise<DiscoveredDeviceApp[]>;
  openApp(packageName: string): Promise<boolean>;
  getNotificationSourceStatus(): Promise<NotificationSourceStatus>;
  openNotificationAccessSettings(): Promise<boolean>;
  setNotificationSourceEnabled(packageName: string, enabled: boolean): Promise<boolean>;
  drainNotificationPreviews(): Promise<MobileNotificationPreview[]>;
  acknowledgeNotificationPreviews(eventIds: string[]): Promise<boolean>;
}

export type DeviceDiscoveryStatus = 'available' | 'unavailable';
const EMPTY_NOTIFICATION_STATUS: NotificationSourceStatus = { accessGranted: false, enabledPackageCount: 0, pendingCount: 0 };

function bridge(): NativeDeviceBridge | null {
  if (Platform.OS !== 'android') return null;
  const candidate = NativeModules.LazyArmorDeviceBridge as Partial<NativeDeviceBridge> | undefined;
  if (typeof candidate?.discoverLaunchableApps !== 'function' || typeof candidate?.openApp !== 'function') return null;
  return candidate as NativeDeviceBridge;
}

export function deviceDiscoveryStatus(): DeviceDiscoveryStatus {
  return bridge() ? 'available' : 'unavailable';
}

export async function discoverLaunchableApps(): Promise<DiscoveredDeviceApp[]> {
  const native = bridge();
  if (!native) return [];
  try {
    return (await native.discoverLaunchableApps())
      .filter((app) => app.launchable && Boolean(app.packageName) && Boolean(app.displayName) && /^[a-f0-9]{64}$/.test(app.discoveryFingerprint))
      .slice(0, 200);
  } catch {
    return [];
  }
}

export async function openDeviceApp(packageName: string): Promise<boolean> {
  if (!packageName.trim()) return false;
  const native = bridge();
  if (!native) return false;
  try { return await native.openApp(packageName); } catch { return false; }
}

export async function notificationSourceStatus(): Promise<NotificationSourceStatus> {
  const native = bridge();
  if (!native || typeof native.getNotificationSourceStatus !== 'function') return EMPTY_NOTIFICATION_STATUS;
  try { return await native.getNotificationSourceStatus(); } catch { return EMPTY_NOTIFICATION_STATUS; }
}

export async function openNotificationAccessSettings(): Promise<boolean> {
  const native = bridge();
  if (!native || typeof native.openNotificationAccessSettings !== 'function') return false;
  try { return await native.openNotificationAccessSettings(); } catch { return false; }
}

export async function setNotificationSourceEnabled(packageName: string, enabled: boolean): Promise<boolean> {
  if (!packageName.trim()) return false;
  const native = bridge();
  if (!native || typeof native.setNotificationSourceEnabled !== 'function') return false;
  try { return await native.setNotificationSourceEnabled(packageName, enabled); } catch { return false; }
}

export async function drainNotificationPreviews(): Promise<MobileNotificationPreview[]> {
  const native = bridge();
  if (!native || typeof native.drainNotificationPreviews !== 'function') return [];
  try {
    return (await native.drainNotificationPreviews()).filter((item) => /^[a-f0-9]{64}$/.test(item.eventId) && /^[a-f0-9]{64}$/.test(item.contentHash) && Boolean(item.sourcePackage));
  } catch {
    return [];
  }
}

export async function acknowledgeNotificationPreviews(eventIds: string[]): Promise<boolean> {
  const accepted = [...new Set(eventIds.filter((item) => /^[a-f0-9]{64}$/.test(item)))];
  if (accepted.length === 0) return true;
  const native = bridge();
  if (!native || typeof native.acknowledgeNotificationPreviews !== 'function') return false;
  try { return await native.acknowledgeNotificationPreviews(accepted); } catch { return false; }
}
