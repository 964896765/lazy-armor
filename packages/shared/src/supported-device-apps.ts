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

export type DeviceAppCaptureMode = 'notification_read' | 'share' | 'app_read_session' | 'structured_read' | 'vision';

/**
 * R2-06 static capability metadata for one Android package. It only describes
 * what the platform *could* do with this app; it is never an authorization
 * grant. installed / authorized / healthy / available are runtime projections,
 * not part of this static catalog.
 */
export interface DeviceAppCatalogMetadata {
  packageName: string;
  supported: boolean;
  sourceCapabilities: readonly DeviceAppCaptureMode[];
  actionCapabilities: readonly string[];
  riskClass: string;
  verificationMethod: string;
  notificationReadable: boolean;
  shareReadable: boolean;
  appReadSessionSupported: boolean;
  structuredReadSupported: boolean;
  visionFallbackAllowed: boolean;
}

const GENERIC_SOURCE_CAPABILITIES: readonly DeviceAppCaptureMode[] = ['notification_read', 'app_read_session'];

/** Curated source capability hints for well-known packages; never an allowlist or grant. */
const DEVICE_APP_METADATA: Readonly<Record<string, { sourceCapabilities: readonly DeviceAppCaptureMode[]; actionCapabilities: readonly string[]; riskClass: string; verificationMethod: string }>> = Object.freeze({
  'com.eg.android.AlipayGphone': Object.freeze({ sourceCapabilities: ['notification_read', 'share', 'app_read_session'] as const, actionCapabilities: ['READ_TRANSACTION'] as const, riskClass: 'R2', verificationMethod: 'READ_BACK' }),
  'com.tencent.mm': Object.freeze({ sourceCapabilities: ['notification_read', 'share', 'app_read_session'] as const, actionCapabilities: ['READ_TRANSACTION'] as const, riskClass: 'R2', verificationMethod: 'READ_BACK' }),
  'com.cainiao.wireless': Object.freeze({ sourceCapabilities: ['notification_read', 'app_read_session'] as const, actionCapabilities: ['READ_SHIPMENT'] as const, riskClass: 'R1', verificationMethod: 'READ_BACK' }),
  'com.sf.activity': Object.freeze({ sourceCapabilities: ['notification_read', 'app_read_session'] as const, actionCapabilities: ['READ_SHIPMENT'] as const, riskClass: 'R1', verificationMethod: 'READ_BACK' }),
});

export function deviceAppCatalogMetadata(packageName: string): DeviceAppCatalogMetadata {
  const override = DEVICE_APP_METADATA[packageName];
  const sourceCapabilities = override?.sourceCapabilities ?? GENERIC_SOURCE_CAPABILITIES;
  return {
    packageName,
    supported: Boolean(override || deviceAppIntegration(packageName)),
    sourceCapabilities,
    actionCapabilities: override?.actionCapabilities ?? [],
    riskClass: override?.riskClass ?? 'R1',
    verificationMethod: override?.verificationMethod ?? 'READ_BACK',
    notificationReadable: sourceCapabilities.includes('notification_read'),
    shareReadable: sourceCapabilities.includes('share'),
    appReadSessionSupported: sourceCapabilities.includes('app_read_session'),
    structuredReadSupported: sourceCapabilities.includes('structured_read'),
    visionFallbackAllowed: sourceCapabilities.includes('vision'),
  };
}
