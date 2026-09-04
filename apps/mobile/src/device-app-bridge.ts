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

export interface TrustedDeviceIdentity {
  keyId: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
}

export interface TrustedDeviceRequestEnvelope {
  requestId: string;
  signedAt: string;
  payloadHash: string;
  signature: string;
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
  candidateKind: 'unknown' | 'billing_transaction_candidate' | 'account_notification_candidate';
  candidateResource: 'mobile.billing.transaction' | 'mobile.account.notification' | null;
  candidateConfidence: number;
  amountMinor: number | null;
  currency: 'CNY' | null;
  parserVersion: 'generic-notification-v1';
  status: 'received_unclassified';
}

interface NativeDeviceBridge {
  getTrustedDeviceIdentity(): Promise<TrustedDeviceIdentity>;
  signTrustedDeviceChallenge(payload: string): Promise<string>;
  signTrustedDeviceRequest(payload: string): Promise<string>;
  createTrustedDeviceRequestEnvelope(sessionId: string, method: string, requestPath: string, payloadJson: string): Promise<TrustedDeviceRequestEnvelope>;
  createTrustedDeviceRequestId(): Promise<string>;
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

export async function trustedDeviceIdentity(): Promise<TrustedDeviceIdentity | null> {
  const native = bridge();
  if (!native || typeof native.getTrustedDeviceIdentity !== 'function') return null;
  try {
    const identity = await native.getTrustedDeviceIdentity();
    if (!identity?.keyId || !/^[a-f0-9]{64}$/.test(identity.publicKeyFingerprint) || !identity.publicKeySpki) return null;
    return identity;
  } catch {
    return null;
  }
}

export async function signTrustedDeviceChallenge(payload: string): Promise<string | null> {
  if (!payload.startsWith('lazy-armor-device-proof-v1|') || payload.length > 512) return null;
  const native = bridge();
  if (!native || typeof native.signTrustedDeviceChallenge !== 'function') return null;
  try {
    const signature = await native.signTrustedDeviceChallenge(payload);
    return /^[A-Za-z0-9+/]+={0,2}$/.test(signature) ? signature : null;
  } catch {
    return null;
  }
}

export async function signTrustedDeviceRequest(payload: string): Promise<string | null> {
  if (!payload.startsWith('lazy-armor-device-request-v1|') || payload.length > 1024) return null;
  const native = bridge();
  if (!native || typeof native.signTrustedDeviceRequest !== 'function') return null;
  try {
    const signature = await native.signTrustedDeviceRequest(payload);
    return /^[A-Za-z0-9+/]+={0,2}$/.test(signature) ? signature : null;
  } catch {
    return null;
  }
}

export async function createTrustedDeviceRequestEnvelope(sessionId: string, method: 'POST', requestPath: string, payloadJson: string): Promise<TrustedDeviceRequestEnvelope | null> {
  if (!sessionId || requestPath.length === 0 || requestPath.length > 255 || payloadJson.length > 65_536) return null;
  const native = bridge();
  if (!native || typeof native.createTrustedDeviceRequestEnvelope !== 'function') return null;
  try {
    const envelope = await native.createTrustedDeviceRequestEnvelope(sessionId, method, requestPath, payloadJson);
    if (!/^[a-f0-9]{64}$/.test(envelope?.requestId) || !/^[a-f0-9]{64}$/.test(envelope?.payloadHash) || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope?.signature) || Number.isNaN(new Date(envelope?.signedAt).getTime())) return null;
    return envelope;
  } catch {
    return null;
  }
}

export async function createTrustedDeviceRequestId(): Promise<string | null> {
  const native = bridge();
  if (!native || typeof native.createTrustedDeviceRequestId !== 'function') return null;
  try {
    const requestId = await native.createTrustedDeviceRequestId();
    return /^[a-f0-9]{64}$/.test(requestId) ? requestId : null;
  } catch {
    return null;
  }
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
    return (await native.drainNotificationPreviews()).filter((item) => isSafeNotificationPreview(item));
  } catch {
    return [];
  }
}

function isSafeNotificationPreview(item: MobileNotificationPreview) {
  const knownCandidate = item.candidateKind === 'unknown' || item.candidateKind === 'billing_transaction_candidate' || item.candidateKind === 'account_notification_candidate';
  const knownResource = item.candidateResource === null || item.candidateResource === 'mobile.billing.transaction' || item.candidateResource === 'mobile.account.notification';
  const validMoney = item.amountMinor === null || (Number.isSafeInteger(item.amountMinor) && item.amountMinor >= 0 && item.amountMinor <= 2_147_483_647);
  const validCurrency = item.currency === null || item.currency === 'CNY';
  return /^[a-f0-9]{64}$/.test(item.eventId) && /^[a-f0-9]{64}$/.test(item.contentHash) && Boolean(item.sourcePackage)
    && knownCandidate && knownResource && Number.isInteger(item.candidateConfidence) && item.candidateConfidence >= 0 && item.candidateConfidence <= 100
    && validMoney && validCurrency && item.parserVersion === 'generic-notification-v1' && item.status === 'received_unclassified';
}

export async function acknowledgeNotificationPreviews(eventIds: string[]): Promise<boolean> {
  const accepted = [...new Set(eventIds.filter((item) => /^[a-f0-9]{64}$/.test(item)))];
  if (accepted.length === 0) return true;
  const native = bridge();
  if (!native || typeof native.acknowledgeNotificationPreviews !== 'function') return false;
  try { return await native.acknowledgeNotificationPreviews(accepted); } catch { return false; }
}
