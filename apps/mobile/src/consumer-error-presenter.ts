export type ConsumerNotificationCategory =
  | 'REMINDER'
  | 'NEEDS_CONFIRMATION'
  | 'CONNECTION_INVALID'
  | 'DEVICE_OFFLINE'
  | 'EXECUTION_SUCCEEDED'
  | 'EXECUTION_FAILED'
  | 'RESULT_PENDING';

const CATEGORY_BY_EVENT: Record<string, ConsumerNotificationCategory> = {
  approval_required: 'NEEDS_CONFIRMATION',
  p0_7_safety_gate_blocked: 'NEEDS_CONFIRMATION',
  permission_revoked: 'CONNECTION_INVALID',
  connection_reconnect_required: 'CONNECTION_INVALID',
  credential_revoked: 'CONNECTION_INVALID',
  missing_connection: 'CONNECTION_INVALID',
  device_offline: 'DEVICE_OFFLINE',
  execution_succeeded: 'EXECUTION_SUCCEEDED',
  execution_failed: 'EXECUTION_FAILED',
  side_effect_dead_letter: 'EXECUTION_FAILED',
  plan_failed: 'EXECUTION_FAILED',
  unknown_internal_error: 'EXECUTION_FAILED',
  configuration_incomplete: 'EXECUTION_FAILED',
  provider_unavailable: 'EXECUTION_FAILED',
  rate_limited: 'EXECUTION_FAILED',
  network_failure: 'EXECUTION_FAILED',
  provider_timeout: 'EXECUTION_FAILED',
  side_effect_outcome_unknown: 'RESULT_PENDING',
};

export function notificationCategory(eventType: string): ConsumerNotificationCategory {
  return CATEGORY_BY_EVENT[eventType] ?? 'REMINDER';
}

export function notificationCategoryLabel(category: ConsumerNotificationCategory): string {
  switch (category) {
    case 'NEEDS_CONFIRMATION': return '需要确认';
    case 'CONNECTION_INVALID': return '连接失效';
    case 'DEVICE_OFFLINE': return '设备离线';
    case 'EXECUTION_SUCCEEDED': return '执行成功';
    case 'EXECUTION_FAILED': return '执行失败';
    case 'RESULT_PENDING': return '结果待确认';
    default: return '提醒';
  }
}

export interface NotificationDeepLinkInput {
  eventType?: string | null;
  executionId?: string | null;
  approvalRequestId?: string | null;
  connectionId?: string | null;
  reconciliationCaseId?: string | null;
}

/**
 * 通知跳转绝不回首页。连接失效去对应连接、审批去审批详情、结果去记录详情；
 * 结果待确认优先跳到 Reconciliation 回查；普通提醒不强制跳转，返回 null 由调用方保持原位。
 */
export function notificationDeepLink(input: NotificationDeepLinkInput): string | null {
  const category = notificationCategory(input.eventType ?? '');
  if (category === 'CONNECTION_INVALID') {
    return input.connectionId ? `/connections/${input.connectionId}` : '/connections';
  }
  if (category === 'NEEDS_CONFIRMATION') {
    return input.approvalRequestId ? `/approvals/${input.approvalRequestId}` : '/approvals';
  }
  if (category === 'RESULT_PENDING') {
    if (input.reconciliationCaseId) return `/reconciliation/${input.reconciliationCaseId}`;
    return input.executionId ? `/executions/${input.executionId}` : '/records';
  }
  if (category === 'EXECUTION_SUCCEEDED' || category === 'EXECUTION_FAILED') {
    return input.executionId ? `/executions/${input.executionId}` : '/records';
  }
  return null;
}

export function consumerErrorLabel(code: string, providerName?: string | null): string {
  switch (code) {
    case 'AUTH_REVOKED':
    case 'CREDENTIAL_REVOKED':
    case 'CREDENTIAL_INVALID':
      return `${providerName ?? '账号'}授权已失效，请重新连接`;
    case 'MCP_SCHEMA_CHANGED':
      return '这个连接的能力发生了变化，需要重新确认';
    case 'RESULT_VERIFICATION_FAILED':
    case 'OUTCOME_UNKNOWN':
      return '操作已经发出，但暂时无法确认结果';
    case 'TRUTH_VERSION_CONFLICT':
      return '数据刚刚发生变化，请重新确认';
    case 'SAFETY_GATE_REQUIRES_APPROVAL_AND_IDEMPOTENCY':
      return '这是高风险动作，已安全阻断，需要你确认后再继续';
    case 'PERMISSION_REVOKED':
      return '相关授权已经被撤销';
    case 'CONNECTION_REVOKED':
    case 'CONNECTION_EXPIRED':
      return '连接已经失效，请重新连接';
    case 'RATE_LIMITED':
      return '服务方临时限制了访问频率，稍后再试';
    case 'PROVIDER_UNAVAILABLE':
      return '服务暂时不可用，稍后再试';
    case 'TRUTH_STALE':
      return '数据有点旧，需要重新获取';
    case 'DEVICE_OFFLINE':
      return '你的手机当前不在线';
    case 'VERIFICATION_UNAVAILABLE':
      return '已执行，但暂时无法确认结果';
    default:
      return '这次处理暂时没有完成，可以稍后再试';
  }
}

export function consumerErrorNextStep(code: string): string {
  switch (code) {
    case 'AUTH_REVOKED':
    case 'CREDENTIAL_REVOKED':
    case 'CREDENTIAL_INVALID':
    case 'CONNECTION_REVOKED':
    case 'CONNECTION_EXPIRED':
      return '去「连接」重新连接后，相关计划会继续运行。';
    case 'MCP_SCHEMA_CHANGED':
      return '去「连接」重新确认授权范围后继续使用。';
    case 'RESULT_VERIFICATION_FAILED':
    case 'OUTCOME_UNKNOWN':
    case 'VERIFICATION_UNAVAILABLE':
      return '打开记录回查实际结果；结果未核实前不要重复执行原动作。';
    case 'TRUTH_VERSION_CONFLICT':
      return '回到详情重新确认后再继续。';
    case 'SAFETY_GATE_REQUIRES_APPROVAL_AND_IDEMPOTENCY':
      return '在审批中心完成确认后再继续。';
    case 'PERMISSION_REVOKED':
      return '去「连接」重新授权对应来源。';
    case 'RATE_LIMITED':
    case 'PROVIDER_UNAVAILABLE':
      return '稍后重新检查即可。';
    case 'DEVICE_OFFLINE':
      return '恢复网络或打开设备后再检查。';
    default:
      return '如果连续失败，请检查连接和权限。';
  }
}
