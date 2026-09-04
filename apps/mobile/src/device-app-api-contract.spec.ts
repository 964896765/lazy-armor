import { describe, expect, it } from 'vitest';
import { createDeviceAppConnectionRequest } from './device-app-api-contract';

describe('DeviceAppConnection request contract', () => {
  it('creates a normalized request only for an allowlisted app and available operation', () => {
    expect(createDeviceAppConnectionRequest(' device-1 ', 'com.google.android.calendar', ['open_app', 'open_app'])).toEqual({
      deviceId: 'device-1', packageName: 'com.google.android.calendar', modes: ['open_app'],
    });
  });

  it('rejects empty device IDs, arbitrary packages, and planned capabilities client-side', () => {
    expect(createDeviceAppConnectionRequest('', 'com.google.android.calendar', ['open_app'])).toBeNull();
    expect(createDeviceAppConnectionRequest('device-1', 'com.example.unlisted', ['open_app'])).toBeNull();
    expect(createDeviceAppConnectionRequest('device-1', 'com.eg.android.AlipayGphone', ['deep_link'])).toBeNull();
  });
});
