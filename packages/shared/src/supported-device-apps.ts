export type DeviceAppConnectionMode = 'open_app' | 'receive_share' | 'notification_read' | 'deep_link';

export interface AppIntegrationCapability {
  mode: DeviceAppConnectionMode;
  label: string;
  description: string;
  requiresUserPermission: boolean;
  availability: 'available' | 'planned';
}

/**
 * Catalog is an optional enhancement layer, never a connection allowlist.
 * Generic DeviceAppConnection remains available for every user-confirmed,
 * launchable application discovered from the current Android device.
 */
export interface AppIntegrationCatalogEntry {
  integrationKey: string;
  packageMatcher: string;
  providerKey: string;
  capabilities: readonly AppIntegrationCapability[];
}

export const GENERIC_APP_CAPABILITIES: readonly AppIntegrationCapability[] = Object.freeze([
  { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开该应用。', requiresUserPermission: false, availability: 'available' },
  { mode: 'receive_share', label: '接收分享内容', description: '后续可由你主动从其他应用分享内容到懒人装甲。', requiresUserPermission: true, availability: 'planned' },
  { mode: 'notification_read', label: '读取指定通知', description: '仅在你单独授权后，把该应用通知作为待核实的信息来源。', requiresUserPermission: true, availability: 'available' },
]);

export const APP_INTEGRATION_CATALOG: readonly AppIntegrationCatalogEntry[] = Object.freeze([
  {
    integrationKey: 'gmail',
    packageMatcher: 'com.google.android.gm',
    providerKey: 'gmail',
    capabilities: [
      { mode: 'deep_link', label: '打开邮件页面', description: '后续仅使用经验证的页面跳转方式；邮件读取仍需独立 OAuth 连接。', requiresUserPermission: false, availability: 'planned' },
    ],
  },
  {
    integrationKey: 'google_calendar',
    packageMatcher: 'com.google.android.calendar',
    providerKey: 'google_calendar',
    capabilities: [
      { mode: 'deep_link', label: '打开日历页面', description: '后续仅使用经验证的页面跳转方式；日程同步仍需独立 OAuth 连接。', requiresUserPermission: false, availability: 'planned' },
    ],
  },
]);

export function deviceAppIntegration(packageName: string): AppIntegrationCatalogEntry | null {
  return APP_INTEGRATION_CATALOG.find((entry) => entry.packageMatcher === packageName) ?? null;
}

export function deviceAppCapabilities(packageName: string): readonly AppIntegrationCapability[] {
  return [...GENERIC_APP_CAPABILITIES, ...(deviceAppIntegration(packageName)?.capabilities ?? [])];
}

export function isGenericDeviceAppMode(mode: string): mode is Extract<DeviceAppConnectionMode, 'open_app' | 'receive_share' | 'notification_read'> {
  return mode === 'open_app' || mode === 'receive_share' || mode === 'notification_read';
}
