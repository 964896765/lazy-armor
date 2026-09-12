export type RuntimeResultState = 'SUCCEEDED' | 'PARTIALLY_SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
export interface ReconciliationCaseSummary {
  id: string;
  status: 'OPEN' | 'RECONCILING' | 'RESOLVED' | 'NEEDS_USER';
  resultState: RuntimeResultState;
  attemptCount: number;
}
export function runtimeResultLabel(state: RuntimeResultState | null | undefined): string | null {
  return state ? ({ SUCCEEDED: '已确认成功', PARTIALLY_SUCCEEDED: '部分成功', FAILED: '已确认失败', OUTCOME_UNKNOWN: '结果未知，正在收口' })[state] : null;
}
export function reconciliationStatusLabel(status: ReconciliationCaseSummary['status']) {
  return ({ OPEN: '等待只读回查', RECONCILING: '回查中', RESOLVED: '已收口', NEEDS_USER: '需要核实实际结果' })[status];
}
export function canRequestReconciliation(row: ReconciliationCaseSummary) { return row.status === 'OPEN'; }
export function verificationSafetyCopy() { return '操作可能已经生效。系统只回查实际结果，不会重发原动作；请勿在结果未核实前重复执行。'; }
