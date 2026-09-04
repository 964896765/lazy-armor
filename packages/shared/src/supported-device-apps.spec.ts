import { describe, expect, it } from 'vitest';
import { APP_INTEGRATION_CATALOG, GENERIC_APP_CAPABILITIES, deviceAppCapabilities, deviceAppIntegration, isGenericDeviceAppMode } from './supported-device-apps';

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
});
