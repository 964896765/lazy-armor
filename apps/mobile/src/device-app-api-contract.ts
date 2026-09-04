import type { DeviceAppConnectionMode } from '@lazy-armor/shared';
import type { DiscoveredDeviceApp, MobileNotificationPreview } from './device-app-bridge';

export interface CreateDeviceAppConnectionRequest {
  deviceId: string;
  packageName: string;
  displayName: string;
  versionName?: string;
  versionCode?: number;
  launchable: true;
  discoveryFingerprint: string;
  modes: DeviceAppConnectionMode[];
}

export interface CreateMobileNotificationReceiptRequest {
  eventId: string;
  contentHash: string;
  sourcePackage: string;
  postedAt: string;
  capturedAt: string;
  hasTitle: boolean;
  hasText: boolean;
}

export function createMobileNotificationReceiptRequest(preview: MobileNotificationPreview): CreateMobileNotificationReceiptRequest | null {
  if (!/^[a-f0-9]{64}$/.test(preview.eventId) || !/^[a-f0-9]{64}$/.test(preview.contentHash) || !preview.sourcePackage.trim()) return null;
  const postedAt = new Date(preview.postedAt);
  const capturedAt = new Date(preview.capturedAt);
  if (!Number.isFinite(postedAt.getTime()) || !Number.isFinite(capturedAt.getTime())) return null;
  return { eventId: preview.eventId, contentHash: preview.contentHash, sourcePackage: preview.sourcePackage.trim(), postedAt: postedAt.toISOString(), capturedAt: capturedAt.toISOString(), hasTitle: Boolean(preview.hasTitle), hasText: Boolean(preview.hasText) };
}

export function createDeviceAppConnectionRequest(deviceId: string, discovered: DiscoveredDeviceApp): CreateDeviceAppConnectionRequest | null {
  const normalizedDeviceId = deviceId.trim();
  const packageName = discovered.packageName.trim();
  const displayName = discovered.displayName.trim();
  if (!normalizedDeviceId || !packageName || !displayName || !discovered.launchable || !/^[a-f0-9]{64}$/.test(discovered.discoveryFingerprint)) return null;
  if (discovered.versionCode !== null && (!Number.isInteger(discovered.versionCode) || discovered.versionCode < 0 || !Number.isSafeInteger(discovered.versionCode))) return null;
  return {
    deviceId: normalizedDeviceId,
    packageName,
    displayName,
    ...(discovered.versionName?.trim() ? { versionName: discovered.versionName.trim() } : {}),
    ...(discovered.versionCode === null ? {} : { versionCode: discovered.versionCode }),
    launchable: true,
    discoveryFingerprint: discovered.discoveryFingerprint,
    modes: ['open_app'],
  };
}
