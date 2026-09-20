import type { DeviceAppConnectionMode } from '@lazy-armor/shared';
import type { DiscoveredDeviceApp, MobileNotificationPreview } from './device-app-bridge';

export interface CreateDeviceAppConnectionRequest {
  trustedDeviceId: string;
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
  candidateKind: MobileNotificationPreview['candidateKind'];
  candidateResource: MobileNotificationPreview['candidateResource'];
  candidateConfidence: number;
  amountMinor: number | null;
  currency: 'CNY' | null;
  candidateStatus: string | null;
  parserVersion: 'generic-notification-v1';
}

export function createMobileNotificationReceiptRequest(preview: MobileNotificationPreview): CreateMobileNotificationReceiptRequest | null {
  if (!/^[a-f0-9]{64}$/.test(preview.eventId) || !/^[a-f0-9]{64}$/.test(preview.contentHash) || !preview.sourcePackage.trim()) return null;
  if (!Number.isInteger(preview.candidateConfidence) || preview.candidateConfidence < 0 || preview.candidateConfidence > 100 || preview.parserVersion !== 'generic-notification-v1' || preview.status !== 'received_unclassified') return null;
  if (!candidateIsCoherent(preview)) return null;
  const postedAt = new Date(preview.postedAt);
  const capturedAt = new Date(preview.capturedAt);
  if (!Number.isFinite(postedAt.getTime()) || !Number.isFinite(capturedAt.getTime())) return null;
  return { eventId: preview.eventId, contentHash: preview.contentHash, sourcePackage: preview.sourcePackage.trim(), postedAt: postedAt.toISOString(), capturedAt: capturedAt.toISOString(), hasTitle: Boolean(preview.hasTitle), hasText: Boolean(preview.hasText), candidateKind: preview.candidateKind, candidateResource: preview.candidateResource, candidateConfidence: preview.candidateConfidence, amountMinor: preview.amountMinor, currency: preview.currency, candidateStatus: preview.candidateStatus ?? null, parserVersion: preview.parserVersion };
}

function candidateIsCoherent(preview: MobileNotificationPreview) {
  const status = preview.candidateStatus ?? null;
  if (preview.candidateKind === 'unknown') return preview.candidateResource === null && preview.amountMinor === null && preview.currency === null && status === null && preview.candidateConfidence === 0;
  if (preview.candidateKind === 'billing_transaction_candidate') return preview.candidateResource === 'mobile.billing.transaction' && Number.isSafeInteger(preview.amountMinor) && (preview.amountMinor as number) >= 0 && preview.currency === 'CNY' && status === null;
  if (preview.candidateKind === 'account_notification_candidate') return preview.candidateResource === 'mobile.account.notification' && preview.amountMinor === null && preview.currency === null && status === null;
  if (preview.candidateKind === 'shipment_candidate') return preview.candidateResource === 'shipment' && preview.amountMinor === null && preview.currency === null && typeof status === 'string' && status.length > 0;
  if (preview.candidateKind === 'bill_candidate') return preview.candidateResource === 'Bill' && preview.amountMinor === null && preview.currency === null && typeof status === 'string' && status.length > 0;
  if (preview.candidateKind === 'device_candidate') return preview.candidateResource === 'DeviceStatus' && preview.amountMinor === null && preview.currency === null && typeof status === 'string' && status.length > 0;
  return false;
}

export function createDeviceAppConnectionRequest(deviceId: string, trustedDeviceId: string, discovered: DiscoveredDeviceApp): CreateDeviceAppConnectionRequest | null {
  const normalizedDeviceId = deviceId.trim();
  const normalizedTrustedDeviceId = trustedDeviceId.trim();
  const packageName = discovered.packageName.trim();
  const displayName = discovered.displayName.trim();
  if (!normalizedDeviceId || !normalizedTrustedDeviceId || !packageName || !displayName || !discovered.launchable || !/^[a-f0-9]{64}$/.test(discovered.discoveryFingerprint)) return null;
  if (discovered.versionCode !== null && (!Number.isInteger(discovered.versionCode) || discovered.versionCode < 0 || !Number.isSafeInteger(discovered.versionCode))) return null;
  return {
    trustedDeviceId: normalizedTrustedDeviceId,
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
