export type MessageChannel = 'plan' | 'system';

export type MessageChannelFilter = 'all' | MessageChannel;

// 「系统通知」：与计划执行/结果无关的账号、连接、授权、设备事件。
const SYSTEM_EVENT_TYPES = new Set([
  'login', 'login_success', 'security_alert', 'account_security', 'version_update', 'privacy_update',
  'permission_revoked',
  'connection_reconnect_required',
  'credential_revoked',
  'missing_connection',
  'device_offline',
]);

/** 依据 eventType 派生消息分类；未匹配的默认归为「计划动态」。 */
export function messageChannel(eventType: string | null | undefined): MessageChannel {
  if(eventType&&/^(auth_|login_|security_|account_|version_|privacy_)/.test(eventType))return 'system';
  if (eventType && SYSTEM_EVENT_TYPES.has(eventType)) return 'system';
  return 'plan';
}

export function messageChannelLabel(channel: MessageChannel): string {
  return channel === 'system' ? '系统通知' : '计划动态';
}

export function formatUnreadCount(count: number): string {
  if (count <= 0) return '0';
  return count > 99 ? '99+' : String(count);
}
