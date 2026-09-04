export type DeviceAppConnectionMode = 'open_app' | 'deep_link' | 'notification_read';

export interface SupportedDeviceAppCapability {
  mode: DeviceAppConnectionMode;
  label: string;
  description: string;
  requiresUserPermission: boolean;
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  availability: 'available' | 'planned';
}

export interface SupportedDeviceApp {
  packageName: string;
  displayName: string;
  category: 'communication' | 'payment' | 'commerce' | 'telecom' | 'productivity';
  deepLinkScheme?: string;
  capabilities: readonly SupportedDeviceAppCapability[];
}

/**
 * This is an intentionally small allowlist. It is not a device inventory and must not
 * be replaced with QUERY_ALL_PACKAGES or arbitrary package discovery.
 */
export const SUPPORTED_DEVICE_APPS: readonly SupportedDeviceApp[] = Object.freeze([
  {
    packageName: 'com.greenpoint.android.mc10086.activity',
    displayName: '中国移动',
    category: 'telecom',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开中国移动。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'notification_read', label: '读取指定通知', description: '仅在你单独授权通知读取后，提取与已安装计划匹配的账单通知。', requiresUserPermission: true, riskLevel: 'R2', availability: 'planned' },
    ],
  },
  {
    packageName: 'com.tencent.mm',
    displayName: '微信',
    category: 'communication',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开微信。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'deep_link', label: '跳转到允许的页面', description: '仅使用已验证的深链或 Intent，不执行聊天、支付或任意点击。', requiresUserPermission: false, riskLevel: 'R1', availability: 'planned' },
    ],
  },
  {
    packageName: 'com.eg.android.AlipayGphone',
    displayName: '支付宝',
    category: 'payment',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开支付宝。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'deep_link', label: '跳转到允许的页面', description: '只能打开已验证页面；支付、转账和生物验证必须由你本人完成。', requiresUserPermission: false, riskLevel: 'R4', availability: 'planned' },
    ],
  },
  {
    packageName: 'com.taobao.taobao',
    displayName: '淘宝',
    category: 'commerce',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开淘宝。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'deep_link', label: '跳转到允许的页面', description: '后续仅支持被验证的商品或订单页面；不提供自动下单。', requiresUserPermission: false, riskLevel: 'R4', availability: 'planned' },
    ],
  },
  {
    packageName: 'com.google.android.gm',
    displayName: 'Gmail',
    category: 'productivity',
    deepLinkScheme: 'googlegmail',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开 Gmail。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'deep_link', label: '打开邮件应用', description: '后续仅使用 Gmail 支持的已验证跳转方式；邮件读取仍优先使用单独授权的 OAuth 连接。', requiresUserPermission: false, riskLevel: 'R1', availability: 'planned' },
    ],
  },
  {
    packageName: 'com.google.android.calendar',
    displayName: 'Google 日历',
    category: 'productivity',
    deepLinkScheme: 'googlecalendar',
    capabilities: [
      { mode: 'open_app', label: '打开应用', description: '仅在你主动操作时打开 Google 日历。', requiresUserPermission: false, riskLevel: 'R0', availability: 'available' },
      { mode: 'deep_link', label: '打开日历应用', description: '后续仅使用 Google 日历支持的已验证跳转方式；日程同步仍优先使用 OAuth 连接。', requiresUserPermission: false, riskLevel: 'R1', availability: 'planned' },
    ],
  },
]);

const catalogByPackage = new Map(SUPPORTED_DEVICE_APPS.map((app) => [app.packageName, app]));

export function supportedDeviceApp(packageName: string): SupportedDeviceApp | null {
  return catalogByPackage.get(packageName) ?? null;
}
