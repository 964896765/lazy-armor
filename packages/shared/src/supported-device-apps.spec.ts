import { describe, expect, it } from 'vitest';
import { SUPPORTED_DEVICE_APPS, supportedDeviceApp } from './supported-device-apps';

describe('supported device app catalog', () => {
  it('is a small allowlist with unique Android package names', () => {
    expect(SUPPORTED_DEVICE_APPS).toHaveLength(6);
    expect(new Set(SUPPORTED_DEVICE_APPS.map((app) => app.packageName)).size).toBe(SUPPORTED_DEVICE_APPS.length);
    expect(supportedDeviceApp('com.example.unlisted')).toBeNull();
  });

  it('exposes only the reviewed open-app operation as currently available', () => {
    for (const app of SUPPORTED_DEVICE_APPS) {
      expect(app.capabilities.filter((capability) => capability.availability === 'available').map((capability) => capability.mode)).toEqual(['open_app']);
    }
  });

  it('keeps high-risk payment and commerce actions unavailable for automatic execution', () => {
    const alipay = supportedDeviceApp('com.eg.android.AlipayGphone');
    const taobao = supportedDeviceApp('com.taobao.taobao');
    expect(alipay?.capabilities.find((capability) => capability.mode === 'deep_link')).toMatchObject({ availability: 'planned', riskLevel: 'R4' });
    expect(taobao?.capabilities.find((capability) => capability.mode === 'deep_link')).toMatchObject({ availability: 'planned', riskLevel: 'R4' });
  });
});
