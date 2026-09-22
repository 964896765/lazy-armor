import { resolveStructuredReadOutcome, type StructuredReadOutcome } from '@lazy-armor/plan-schema/mobile';

/**
 * Unified Structured Read terminal semantics for mobile UI. candidateIds alone
 * are never presented as verified; the three canonical outcomes come from the
 * shared contract in @lazy-armor/plan-schema.
 */
export function structuredReadOutcome(input: { candidateIds: readonly string[]; truthRecordIds: readonly string[] }): StructuredReadOutcome {
  return resolveStructuredReadOutcome(input);
}

export function structuredReadOutcomeLabel(outcome: StructuredReadOutcome): string {
  switch (outcome) {
    case 'VERIFIED': return '已核实';
    case 'NEEDS_CONFIRMATION': return '需要确认';
    case 'BLOCKED': return '已阻断';
  }
}

export function structuredReadStatusLabel(status: string): string {
  switch (status) {
    case 'VERIFIED': return '已核实';
    case 'NEEDS_CONFIRMATION': return '需要确认';
    case 'BLOCKED': return '已阻断';
    case 'AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE': return '等待设备证据';
    default: return '状态未知';
  }
}

/**
 * DeviceTask 的展示语义必须与 Structured Read 终端语义对齐：
 * SUCCEEDED 只在服务端已写入 verified Truth 时出现；NEEDS_CONFIRMATION 表示
 * 已生成候选但尚未核实，绝不能展示成“已核实”。
 */
export function deviceTaskOutcomeLabel(task: { status: string; errorCode?: string | null }): string {
  if (task.status === 'SUCCEEDED') return '已完成并核实';
  if (task.errorCode === 'NEEDS_CONFIRMATION') return '已采集，等待确认';
  if (task.errorCode === 'RESULT_VERIFICATION_FAILED') return '结果未通过核实';
  if (task.status === 'FAILED') return '没有完成';
  if (task.status === 'PENDING' || task.status === 'CLAIMED' || task.status === 'RUNNING') return '处理中';
  return '状态未知';
}
