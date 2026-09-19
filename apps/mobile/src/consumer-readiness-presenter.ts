export type ConsumerReadiness =
  | 'READY'
  | 'NEEDS_CONNECTION'
  | 'NEEDS_PERMISSION'
  | 'NEEDS_DATA'
  | 'DEVICE_OFFLINE'
  | 'SERVICE_UNAVAILABLE'
  | 'NEEDS_CONFIRMATION'
  | 'RESULT_UNKNOWN';

export interface ReadinessCapabilityInput {
  capabilityKey: string;
  providerAvailability?: string | null;
  implementation?: string | null;
  grant?: string | null;
  health?: string | null;
  usable?: boolean;
}

export interface ScenarioReadinessInput {
  state?: string | null;
  missingFacts?: readonly string[];
  missingCapabilities?: readonly string[];
}

export interface ConsumerReadinessInput {
  scenario: ScenarioReadinessInput;
  capabilities: ReadinessCapabilityInput[];
  runtime?: {
    connectionCount?: number;
    deviceOffline?: boolean;
    providerUnavailable?: boolean;
    resultUnknown?: boolean;
    requiresConfirmation?: boolean;
  };
}

const PERMISSION_GRANT_ISSUES = new Set(['REVOKED', 'EXPIRED', 'NOT_GRANTED', 'PERMISSION_REVOKED', 'REAUTHORIZATION_REQUIRED']);

export function consumerReadiness(input: ConsumerReadinessInput): ConsumerReadiness {
  const { scenario, capabilities, runtime } = input;
  const caps = capabilities ?? [];
  if (runtime?.resultUnknown) return 'RESULT_UNKNOWN';
  if (runtime?.deviceOffline || caps.some((cap) => cap.health === 'DEVICE_OFFLINE')) return 'DEVICE_OFFLINE';
  if (scenario.state === 'DISABLED' || scenario.state === 'BLOCKED_IMPLEMENTATION') return 'SERVICE_UNAVAILABLE';
  if (
    runtime?.providerUnavailable
    || caps.some((cap) => cap.providerAvailability === 'UNAVAILABLE')
    || caps.some((cap) => cap.health === 'PROVIDER_UNAVAILABLE')
    || caps.some((cap) => cap.implementation === 'DISABLED')
  ) return 'SERVICE_UNAVAILABLE';
  const permissionIssue = caps.some((cap) => cap.grant && PERMISSION_GRANT_ISSUES.has(cap.grant))
    || caps.some((cap) => cap.health && PERMISSION_GRANT_ISSUES.has(cap.health));
  if (permissionIssue) return 'NEEDS_PERMISSION';
  const connectionCount = runtime?.connectionCount ?? caps.length;
  const anyUnusable = caps.some((cap) => cap.usable === false);
  if ((scenario.missingCapabilities?.length ?? 0) > 0 || connectionCount === 0 || anyUnusable) return 'NEEDS_CONNECTION';
  if ((scenario.missingFacts?.length ?? 0) > 0) return 'NEEDS_DATA';
  if (runtime?.requiresConfirmation || scenario.state === 'ASSISTED_READY') return 'NEEDS_CONFIRMATION';
  return 'READY';
}

export function consumerReadinessLabel(state: ConsumerReadiness): string {
  switch (state) {
    case 'READY': return '可以使用';
    case 'NEEDS_CONNECTION': return '需要连接';
    case 'NEEDS_PERMISSION': return '需要授权';
    case 'NEEDS_DATA': return '缺少数据';
    case 'DEVICE_OFFLINE': return '手机离线';
    case 'SERVICE_UNAVAILABLE': return '服务暂不可用';
    case 'NEEDS_CONFIRMATION': return '需要确认';
    case 'RESULT_UNKNOWN': return '无法确认执行结果';
  }
}

export function consumerReadinessDetail(state: ConsumerReadiness): string {
  switch (state) {
    case 'READY': return '所需连接、授权和数据都已就绪，可以放心使用。';
    case 'NEEDS_CONNECTION': return '还缺少可用连接，先连接对应来源。';
    case 'NEEDS_PERMISSION': return '连接在，但需要你重新授权后才能继续读取或执行。';
    case 'NEEDS_DATA': return '还没有拿到计划需要的真实数据。';
    case 'DEVICE_OFFLINE': return '你的手机当前不在线，先恢复网络或打开设备。';
    case 'SERVICE_UNAVAILABLE': return '对应服务暂时不可用，稍后再试。';
    case 'NEEDS_CONFIRMATION': return '可以运行，但关键动作执行前需要你确认。';
    case 'RESULT_UNKNOWN': return '动作已发出，但暂时无法确认执行结果。';
  }
}

export function consumerReadinessAction(state: ConsumerReadiness): string {
  switch (state) {
    case 'READY': return '可以开始使用。';
    case 'NEEDS_CONNECTION': return '去「连接」连接对应来源。';
    case 'NEEDS_PERMISSION': return '去「连接」重新授权对应来源。';
    case 'NEEDS_DATA': return '补上需要的数据后即可继续。';
    case 'DEVICE_OFFLINE': return '恢复网络或打开设备后再检查。';
    case 'SERVICE_UNAVAILABLE': return '稍后重新检查。';
    case 'NEEDS_CONFIRMATION': return '执行前留意审批中心。';
    case 'RESULT_UNKNOWN': return '打开记录回查实际结果。';
  }
}
