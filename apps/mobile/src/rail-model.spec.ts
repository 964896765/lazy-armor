import { describe, expect, it } from 'vitest';
import { buildConnectionRailModel } from './rail-model';

describe('connection rail model', () => {
  it('shows real enabled connections and prioritizes action required then unread', () => {
    const model = buildConnectionRailModel({
      providers: [
        { id: 'healthy', key: 'calendar', label: '日历', status: 'connected', unread: 3 },
        { id: 'action', key: 'gmail', label: 'Gmail', status: 'reauthorization_required' },
      ],
      deviceApps: [{ id: 'github', packageName: 'com.github.android', label: 'GitHub', enabled: true, trustedDeviceId: 'device-1' }],
      trustedDevices: [{ id: 'device-1', status: 'active' }],
      discoveredApps: [],
    });
    expect(model.visible.map((item) => item.id)).toEqual(['action', 'healthy', 'github']);
    expect(model.visible[0]?.status).toBe('warning');
  });

  it('keeps disabled, revoked and revoked-device connections out of the rail', () => {
    const model = buildConnectionRailModel({
      providers: [{ id: 'revoked-provider', key: 'mail', label: 'Mail', status: 'revoked' }],
      deviceApps: [
        { id: 'disabled', packageName: 'disabled', label: 'Disabled', enabled: false, trustedDeviceId: 'active' },
        { id: 'revoked', packageName: 'revoked', label: 'Revoked', enabled: true, trustedDeviceId: 'revoked-device' },
      ],
      trustedDevices: [{ id: 'active', status: 'active' }, { id: 'revoked-device', status: 'revoked' }],
      discoveredApps: [],
    });
    expect(model.visible).toEqual([]);
  });

  it('collapses only unconnected discovered apps and reports connected overflow', () => {
    const model = buildConnectionRailModel({
      providers: Array.from({ length: 5 }, (_, index) => ({ id: `provider-${index}`, key: `p-${index}`, label: `P${index}`, status: 'connected' })),
      deviceApps: [{ id: 'connected-app', packageName: 'connected', label: 'Connected', enabled: true, trustedDeviceId: 'active' }],
      trustedDevices: [{ id: 'active', status: 'active' }],
      discoveredApps: [{ packageName: 'connected', iconDataUri: 'connected-icon' }, { packageName: 'new-a', iconDataUri: 'a' }, { packageName: 'new-b' }],
      maxVisible: 4,
    });
    expect(model.overflowCount).toBe(2);
    expect(model.collapsedAppCount).toBe(2);
    expect(model.collapsedAppIconUris).toEqual(['a']);
  });
});
