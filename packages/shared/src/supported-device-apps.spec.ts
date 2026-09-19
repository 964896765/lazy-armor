import { describe, expect, it } from 'vitest';
import { APP_INTEGRATION_CATALOG, GENERIC_APP_CAPABILITIES, deviceAppCapabilities, deviceAppCatalogMetadata, deviceAppIntegration, isGenericDeviceAppMode } from './supported-device-apps';

describe('app integration catalog', () => {
  it('is an optional enhancement directory, not a device connection allowlist', () => {
    expect(APP_INTEGRATION_CATALOG.map((entry) => entry.integrationKey)).toEqual(['gmail', 'google_calendar']);
    expect(deviceAppIntegration('com.example.local-bank')).toBeNull();
    expect(deviceAppCapabilities('com.example.local-bank')).toEqual(GENERIC_APP_CAPABILITIES);
  });

  it('preserves generic base operations for both catalog and non-catalog apps', () => {
    expect(deviceAppCapabilities('com.google.android.gm').map((item) => item.mode)).toEqual(['open_app', 'receive_share', 'notification_read', 'deep_link']);
    expect(deviceAppCapabilities('com.example.local-bank').map((item) => item.mode)).toEqual(['open_app', 'receive_share', 'notification_read']);
  });

  it('marks only reviewed generic operations as currently implemented', () => {
    expect(GENERIC_APP_CAPABILITIES.filter((item) => item.availability === 'available').map((item) => item.mode)).toEqual(['open_app', 'notification_read']);
    expect(isGenericDeviceAppMode('open_app')).toBe(true);
    expect(isGenericDeviceAppMode('deep_link')).toBe(false);
  });

  it('expresses R2-06 capability metadata without treating installation as authorization', () => {
    const alipay = deviceAppCatalogMetadata('com.eg.android.AlipayGphone');
    expect(alipay).toMatchObject({ supported: true, notificationReadable: true, shareReadable: true, appReadSessionSupported: true, actionCapabilities: ['READ_TRANSACTION'], riskClass: 'R2', verificationMethod: 'READ_BACK' });
    expect(alipay.structuredReadSupported).toBe(false);
    expect(alipay.visionFallbackAllowed).toBe(false);

    const generic = deviceAppCatalogMetadata('com.example.local-bank');
    expect(generic).toMatchObject({ supported: false, notificationReadable: true, appReadSessionSupported: true, actionCapabilities: [], riskClass: 'R1' });
    expect(generic.shareReadable).toBe(false);
  });
});
