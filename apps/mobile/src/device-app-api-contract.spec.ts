import { describe, expect, it } from 'vitest';
import { createDeviceAppConnectionRequest, createMobileNotificationReceiptRequest } from './device-app-api-contract';

const discoveredApp = {
  packageName: 'com.example.localbank',
  displayName: '本地银行',
  versionName: '1.2.3',
  versionCode: 1203,
  launchable: true,
  iconDataUri: null,
  discoveryFingerprint: 'a'.repeat(64),
} as const;

describe('Generic App Connection request contract', () => {
  it('creates a normalized request for a real discovered app without requiring a catalog entry', () => {
    expect(createDeviceAppConnectionRequest(' device-1 ', 'trusted-device-1', discoveredApp)).toEqual({
      trustedDeviceId: 'trusted-device-1',
      deviceId: 'device-1', packageName: 'com.example.localbank', displayName: '本地银行', versionName: '1.2.3', versionCode: 1203, launchable: true, discoveryFingerprint: 'a'.repeat(64), modes: ['open_app'],
    });
  });

  it('rejects missing device evidence or a non-launchable discovery result', () => {
    expect(createDeviceAppConnectionRequest('', 'trusted-device-1', discoveredApp)).toBeNull();
    expect(createDeviceAppConnectionRequest('device-1', '', discoveredApp)).toBeNull();
    expect(createDeviceAppConnectionRequest('device-1', 'trusted-device-1', { ...discoveredApp, launchable: false })).toBeNull();
    expect(createDeviceAppConnectionRequest('device-1', 'trusted-device-1', { ...discoveredApp, discoveryFingerprint: 'bad' })).toBeNull();
  });

  it('builds a notification receipt only from minimal fingerprints and timestamps', () => {
    const receipt = createMobileNotificationReceiptRequest({ eventId: 'b'.repeat(64), contentHash: 'c'.repeat(64), sourcePackage: 'com.example.localbank', postedAt: Date.UTC(2026, 8, 4), capturedAt: Date.UTC(2026, 8, 4), hasTitle: true, hasText: true, candidateKind: 'unknown', candidateResource: null, candidateConfidence: 0, amountMinor: null, currency: null, parserVersion: 'generic-notification-v1', status: 'received_unclassified' });
    expect(receipt).toMatchObject({ eventId: 'b'.repeat(64), contentHash: 'c'.repeat(64), sourcePackage: 'com.example.localbank', hasTitle: true, hasText: true, candidateKind: 'unknown', candidateResource: null, parserVersion: 'generic-notification-v1' });
    expect(JSON.stringify(receipt)).not.toContain('通知正文');
    expect(createMobileNotificationReceiptRequest({ eventId: 'bad', contentHash: 'c'.repeat(64), sourcePackage: 'com.example.localbank', postedAt: Date.now(), capturedAt: Date.now(), hasTitle: false, hasText: false, candidateKind: 'unknown', candidateResource: null, candidateConfidence: 0, amountMinor: null, currency: null, parserVersion: 'generic-notification-v1', status: 'received_unclassified' })).toBeNull();
    expect(createMobileNotificationReceiptRequest({ eventId: 'b'.repeat(64), contentHash: 'c'.repeat(64), sourcePackage: 'com.example.localbank', postedAt: Date.now(), capturedAt: Date.now(), hasTitle: true, hasText: true, candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 70, amountMinor: null, currency: 'CNY', parserVersion: 'generic-notification-v1', status: 'received_unclassified' })).toBeNull();
  });
});
