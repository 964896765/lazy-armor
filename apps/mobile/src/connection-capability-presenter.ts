import type { ConnectionCapability } from '@lazy-armor/plan-schema';

export function capabilityStatus(capability: ConnectionCapability) {
  if (capability.reasons.includes('CAPABILITY_EXPLICITLY_DENIED')) return '不支持此操作';
  if (['NOT_IMPLEMENTED', 'PARTIAL', 'DISABLED'].includes(capability.implementation)) return '待接入';
  if (capability.providerAvailability === 'UNAVAILABLE') return '平台不支持';
  if (capability.providerAvailability !== 'AVAILABLE') return '能力待核实';
  if (capability.health === 'REAUTHORIZATION_REQUIRED') return '需重新授权';
  if (capability.grant === 'PARTIAL') return '权限不完整';
  if (capability.grant === 'EXPIRED') return '授权已过期';
  if (capability.grant !== 'GRANTED') return '需要授权';
  if (capability.health === 'DEVICE_OFFLINE') return '设备离线';
  if (capability.health === 'RATE_LIMITED') return '来源请求受限';
  if (capability.health === 'PERMISSION_REVOKED') return '需要重新授权';
  if (capability.reasons.includes('CONNECTION_NOT_READY')) return '连接不可用';
  if (capability.reasons.includes('CAPABILITY_HEALTH_EVIDENCE_STALE')) return '检查已过期';
  if (capability.health !== 'HEALTHY') return capability.health === 'UNKNOWN' ? '需要检查' : '来源暂不可用';
  if (!capability.usable) return '暂不可用';
  return capability.implementation === 'BETA' ? '可用 · 试运行' : '可用';
}
export function capabilityPermission(grant: string) {
  return ({ GRANTED: '已授权', PARTIAL: '权限不完整', NOT_GRANTED: '未授权', REVOKED: '已撤回', EXPIRED: '已过期', UNKNOWN: '待核对' } as Record<string,string>)[grant] ?? '待核对';
}
export function capabilitySources(modes: readonly string[]) {
  const labels: Record<string,string> = { OFFICIAL_API: '官方接口', WEBHOOK: '平台消息', OS_API: '系统接口', NOTIFICATION: '设备通知', SHARE: '用户分享', FILE: '用户文件', APP_READ: '应用读取', VISION: '页面识别', MANUAL: '用户提供', PUBLIC_WEB: '公开网页' };
  return modes.map(mode => labels[mode]).filter(Boolean).join('、') || '来源待核对';
}
