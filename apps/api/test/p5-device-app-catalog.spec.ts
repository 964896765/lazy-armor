import { describe, expect, it, vi } from 'vitest';
import { DeviceAppsService } from '../src/device-apps/device-apps.service';

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

describe('DeviceAppConnection safety policy', () => {
  it('rejects an Android package that is not in the reviewed catalog', async () => {
    const { service, values } = fixture();
    await expect(service.create('user-1', { deviceId: 'device-1', packageName: 'com.example.unlisted', modes: ['open_app'] })).rejects.toThrow('not in the supported catalog');
    expect(values).not.toHaveBeenCalled();
  });

  it('fails closed when a client requests a planned notification or deep-link capability', async () => {
    const { service, values } = fixture();
    await expect(service.create('user-1', { deviceId: 'device-1', packageName: 'com.greenpoint.android.mc10086.activity', modes: ['notification_read'] })).rejects.toThrow('not available');
    await expect(service.create('user-1', { deviceId: 'device-1', packageName: 'com.eg.android.AlipayGphone', modes: ['deep_link'] })).rejects.toThrow('not available');
    expect(values).not.toHaveBeenCalled();
  });

  it('stores the reviewed open-app capability and emits an append-only audit entry', async () => {
    const { service, values, audit } = fixture();
    const response = await service.create('user-1', { deviceId: 'device-1', packageName: 'com.google.android.calendar', modes: ['open_app', 'open_app'] });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', deviceId: 'device-1', packageName: 'com.google.android.calendar', displayName: 'Google 日历', modesJson: ['open_app'], trustLevel: 'user_selected',
    }));
    expect(response).toMatchObject({ packageName: 'com.google.android.calendar', enabled: true, modes: ['open_app'] });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_APP_CONNECTION_CREATED', source: 'api', result: 'success', userId: 'user-1' }));
  });
});
