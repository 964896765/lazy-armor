import { describe, expect, it, vi } from 'vitest';
import { DeviceAppsService } from '../src/device-apps/device-apps.service';

const genericDiscoveredApp = {
  deviceId: 'device-1',
  packageName: 'com.example.localbank',
  displayName: '本地银行',
  versionName: '1.2.3',
  versionCode: 1203,
  launchable: true,
  discoveryFingerprint: 'a'.repeat(64),
  modes: ['open_app'],
};

function fixture() {
  let inserted: Record<string, unknown> | null = null;
  const values = vi.fn(async (value: Record<string, unknown>) => { inserted = value; });
  const db = {
    insert: vi.fn(() => ({ values })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [inserted]),
          orderBy: vi.fn(async () => inserted ? [inserted] : []),
        })),
      })),
    })),
  };
  const audit = { append: vi.fn(async () => undefined) };
  return { service: new DeviceAppsService(db as never, audit as never), values, audit };
}

describe('Generic App Connection safety policy', () => {
  it('accepts a user-confirmed, launchable app discovery even when no enhanced adapter exists', async () => {
    const { service, values, audit } = fixture();
    const response = await service.create('user-1', genericDiscoveredApp);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', deviceId: 'device-1', packageName: 'com.example.localbank', displayName: '本地银行', connectionType: 'generic', integrationKey: null, versionName: '1.2.3', versionCode: 1203, launchable: 1, discoveryFingerprint: 'a'.repeat(64), modesJson: ['open_app'], trustLevel: 'device_reported',
    }));
    expect(response).toMatchObject({ packageName: 'com.example.localbank', displayName: '本地银行', connectionType: 'generic', launchable: true, modes: ['open_app'] });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_APP_CONNECTION_CREATED', source: 'api', result: 'success', userId: 'user-1' }));
  });

  it('records a catalog match as optional enhancement rather than an admission requirement', async () => {
    const { service, values } = fixture();
    await service.create('user-1', { ...genericDiscoveredApp, packageName: 'com.google.android.gm', displayName: 'Gmail', discoveryFingerprint: 'b'.repeat(64) });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ connectionType: 'enhanced', integrationKey: 'gmail' }));
  });

  it('allows notification reading only as an explicit generic operation, while unimplemented sharing stays closed', async () => {
    const { service, values } = fixture();
    await expect(service.create('user-1', { ...genericDiscoveredApp, launchable: false })).rejects.toThrow('Only a launchable');
    await expect(service.create('user-1', { ...genericDiscoveredApp, modes: ['receive_share'] })).rejects.toThrow('not currently available');
    await expect(service.create('user-1', { ...genericDiscoveredApp, modes: ['notification_read'] })).resolves.toMatchObject({ modes: ['notification_read'] });
    expect(values).toHaveBeenCalledTimes(1);
  });
});
