export type RuntimeLifecycleState = 'NOT_REACHED' | 'UNKNOWN' | 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'BLOCKED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface RuntimeLifecycleStep {
  step: number;
  key: string;
  label: string;
  state: RuntimeLifecycleState;
  reason: string | null;
}

export interface RuntimeLifecycleResponse {
  subject: { type: 'plan' | 'execution'; id: string; executionId?: string | null };
  lifecycle: { schemaVersion: '1'; readOnly: true; steps: RuntimeLifecycleStep[] };
}

const LIFECYCLE_COPY: Record<RuntimeLifecycleState, { label: string; detail: string; tone: 'muted' | 'brand' | 'success' | 'warning' | 'danger' }> = {
  NOT_REACHED: { label: '尚未到达', detail: '没有记录显示流程已进入这一步。', tone: 'muted' },
  UNKNOWN: { label: '状态未知', detail: '系统没有足够证据确认这一步的结果。', tone: 'warning' },
  RUNNING: { label: '进行中', detail: '这一步仍在处理或等待只读回查。', tone: 'brand' },
  SUCCEEDED: { label: '已完成', detail: '已有持久化运行记录支持这个状态。', tone: 'success' },
  SKIPPED: { label: '已跳过', detail: '该步骤被跳过或执行已取消。', tone: 'muted' },
  BLOCKED: { label: '已阻断', detail: '当前安全条件不允许继续。', tone: 'warning' },
  FAILED: { label: '未完成', detail: '运行记录表明这一步失败。', tone: 'danger' },
  OUTCOME_UNKNOWN: { label: '结果待确认', detail: '动作可能已经生效；必须先只读回查，不能重复原动作。', tone: 'warning' },
};

export function lifecycleStateLabel(state: string): string {
  return LIFECYCLE_COPY[state as RuntimeLifecycleState]?.label ?? '状态未知';
}

export function lifecycleStateDetail(state: string, reason?: string | null): string {
  const base = LIFECYCLE_COPY[state as RuntimeLifecycleState]?.detail ?? '没有可确认的状态说明。';
  return reason ? `${base} 依据：${reason}` : base;
}

export function lifecycleTone(state: string): 'muted' | 'brand' | 'success' | 'warning' | 'danger' {
  return LIFECYCLE_COPY[state as RuntimeLifecycleState]?.tone ?? 'muted';
}

export function readinessLabel(state: string): string {
  return ({
    CATALOG_ONLY: '仅目录定义',
    MANUAL_READY: '可用手动信息开始',
    OBSERVE_READY: '可观察',
    ASSISTED_READY: '可在确认后执行',
    AUTOMATED_READY: '可自动运行',
    BLOCKED_PROVIDER: '服务方受阻',
    BLOCKED_IMPLEMENTATION: '产品实现受阻',
    DISABLED: '已停用',
  } as Record<string, string>)[state] ?? '状态未知';
}

export function capabilityDimensionLabel(dimension: 'providerAvailability' | 'implementation' | 'grant' | 'health', value: string): string {
  const labels: Record<string, Record<string, string>> = {
    providerAvailability: { AVAILABLE: '可用', LIMITED: '有限', UNAVAILABLE: '不开放', TO_VERIFY_OFFICIAL: '待核实' },
    implementation: { PRODUCTION: '已上线', BETA: '测试中', PARTIAL: '部分实现', DISABLED: '已停用', NOT_IMPLEMENTED: '未实现' },
    grant: { GRANTED: '已授权', PARTIAL: '部分授权', REVOKED: '已撤销', EXPIRED: '已过期', NOT_GRANTED: '未授权', UNKNOWN: '未知' },
    health: { HEALTHY: '正常', DEGRADED: '降级', REAUTHORIZATION_REQUIRED: '需重新连接', RATE_LIMITED: '限流', DEVICE_OFFLINE: '设备离线', PROVIDER_UNAVAILABLE: '服务不可用', PERMISSION_REVOKED: '授权已撤销', UNKNOWN: '未知' },
  };
  return labels[dimension][value] ?? '未知';
}

export function capabilityGapCopy(reasons: string[]): string {
  if (reasons.length === 0) return '当前没有已声明的能力缺口。';
  const labels: Record<string, string> = {
    PROVIDER_OFFICIAL_STATUS_UNVERIFIED: '服务方公开能力仍待核实。',
    PROVIDER_CAPABILITY_LIMITED: '服务方只开放了有限能力。',
    PROVIDER_CAPABILITY_UNAVAILABLE: '服务方没有开放这项能力。',
    CAPABILITY_NOT_IMPLEMENTED: '产品尚未实现这项能力。',
    CAPABILITY_IMPLEMENTATION_PARTIAL: '这项能力只实现了一部分。',
    CAPABILITY_DISABLED: '这项能力当前已停用。',
    CAPABILITY_NOT_GRANTED: '尚未获得你的授权。',
    CAPABILITY_SCOPE_PARTIAL: '只获得了部分授权。',
    CAPABILITY_GRANT_REVOKED: '授权已被撤销。',
    CAPABILITY_GRANT_EXPIRED: '授权已过期，需要重新连接。',
    CAPABILITY_GRANT_UNKNOWN: '授权状态无法确认。',
    CAPABILITY_EXPLICITLY_DENIED: '该能力被明确禁止。',
    CAPABILITY_HEALTH_DEGRADED: '当前能力运行健康度不足。',
    CAPABILITY_HEALTH_REAUTHORIZATION_REQUIRED: '需要重新连接授权。',
    CAPABILITY_HEALTH_PERMISSION_REVOKED: '系统权限已被撤销。',
    CAPABILITY_HEALTH_RATE_LIMITED: '服务方暂时限流，请稍后再试。',
    CAPABILITY_HEALTH_PROVIDER_UNAVAILABLE: '服务方暂时不可用。',
    CAPABILITY_HEALTH_DEVICE_OFFLINE: '设备离线，先打开设备或恢复网络。',
    CAPABILITY_HEALTH_UNHEALTHY: '服务方运行异常。',
    CAPABILITY_HEALTH_UNKNOWN: '当前运行健康状态无法确认。',
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(' ');
}

export function readinessReasonCopy(reason: string): string {
  const labels: Record<string, string> = {
    REQUIRED_FACTS_UNAVAILABLE: '缺数据：还没有拿到需要的真实数据。',
    REQUIRED_CAPABILITIES_UNUSABLE: '缺授权或能力：需要先连接并授权对应来源。',
    OBSERVATION_PIPELINE_UNAVAILABLE: '还没有可用的数据来源。',
    EXECUTION_PIPELINE_UNAVAILABLE: '系统执行通道还没就绪。',
  };
  return labels[reason] ?? reason;
}

export function stateActionCopy(state: string): string {
  const actions: Record<string, string> = {
    CATALOG_ONLY: '先去「连接」里连接并授权对应 App，或手动录入关键信息。',
    MANUAL_READY: '你可以先手动录入关键信息，系统会在此基础上继续跟进。',
    BLOCKED_PROVIDER: '去「连接」里连接并授权对应 App，或检查服务方是否正常。',
    BLOCKED_IMPLEMENTATION: '这项能力产品还在准备中，暂时无法使用。',
    DISABLED: '这个场景已被停用。',
    OBSERVE_READY: '可以开始创建计划，系统会持续观察并跟进。',
    ASSISTED_READY: '可以开始创建计划，执行前会先请你确认。',
    AUTOMATED_READY: '可以开始创建计划，系统会在安全边界内自动运行。',
  };
  return actions[state] ?? '先去「连接」里连接并授权对应 App，系统才知道你能做什么。';
}

export function provenanceMethodLabel(value: string): string {
  return ({
    user_confirmation: '你的明确确认',
    user_confirmation_after_device_key_proof: '设备密钥证明后的用户确认',
    SOURCE_EVIDENCE: '来源证据',
    READ_BACK: '只读回查',
  } as Record<string, string>)[value] ?? (value || '未记录');
}

export function reconciliationStatusCopy(status: string): string {
  return ({ OPEN: '等待只读回查', RECONCILING: '正在只读回查', RESOLVED: '已收口', NEEDS_USER: '需要你核实实际结果' } as Record<string, string>)[status] ?? '状态未知';
}

export function reconciliationSafetyCopy(): string {
  return '操作可能已经生效。系统只会进行只读回查，不会重发原动作；结果未核实前请勿重复执行。';
}

export function runtimeResultCopy(value: string): string {
  return ({ SUCCEEDED: '已确认成功', PARTIALLY_SUCCEEDED: '部分成功', FAILED: '已确认失败', OUTCOME_UNKNOWN: '结果待确认' } as Record<string, string>)[value] ?? '结果未知';
}

export function shortHash(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : '未记录';
}

export function displayTime(value: string | null | undefined): string {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN');
}
