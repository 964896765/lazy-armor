export interface PresentableExecutionStep {
  stepOrder: number;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  created: '准备中', queued: '等待处理', running: '正在处理', retry_wait: '正在重试', waiting_approval: '等待确认',
  succeeded: '已完成', partially_succeeded: '部分完成', failed: '执行失败', cancelled: '已取消',
  outcome_unknown: '结果待确认', unknown: '结果待确认',
};

const STEP_MARKS: Record<string, string> = {
  succeeded: '✓', failed: '!', skipped: '○', cancelled: '○', running: '…', retry_wait: '…', pending: '○',
};

export type ExecutionListState = 'loading' | 'error' | 'empty' | 'ready';
export type ExecutionRecordCategory = 'success' | 'processing' | 'failed' | 'exception' | 'outcome';

const CATEGORY_LABELS: Record<ExecutionRecordCategory, string> = {
  success: '成功', processing: '处理中', failed: '失败', exception: '异常', outcome: '结果待确认',
};

export function executionRecordCategory(status: string, resultState?: string | null): ExecutionRecordCategory {
  if (resultState === 'OUTCOME_UNKNOWN') return 'outcome';
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'failed';
  if (['created', 'queued', 'running', 'retry_wait', 'waiting_dispatch'].includes(status)) return 'processing';
  return 'exception';
}

export function executionRecordCategoryLabel(category: ExecutionRecordCategory): string { return CATEGORY_LABELS[category]; }

export function executionStatusLabel(status: string) { return STATUS_LABELS[status] ?? '处理中'; }
export function executionStepMark(status: string) { return STEP_MARKS[status] ?? '○'; }
export function sortExecutionSteps<T extends PresentableExecutionStep>(steps: T[]) { return [...steps].sort((left, right) => left.stepOrder - right.stepOrder); }
export function executionListState(loading: boolean, error: boolean, count: number): ExecutionListState {
  if (loading) return 'loading';
  if (error) return 'error';
  return count === 0 ? 'empty' : 'ready';
}

export function executionNeedsAttention(status: string) {
  return ['failed', 'partially_succeeded', 'waiting_approval', 'cancelled', 'outcome_unknown', 'unknown'].includes(status);
}

export function executionAttentionLabel(status: string) {
  if (status === 'waiting_approval') return '需要你确认';
  if (status === 'failed' || status === 'partially_succeeded') return '需要你处理';
  if (status === 'cancelled') return '这次已取消';
  if (status === 'outcome_unknown' || status === 'unknown') return '结果待确认';
  if (executionRecordCategory(status) === 'processing') return '正在处理';
  return status === 'succeeded' ? '已完成' : '需要查看结果';
}

export function executionStepSummary(status: string) {
  switch (status) {
    case 'succeeded':
      return '这一步已经完成。';
    case 'failed':
      return '这一步没有完成。';
    case 'running':
      return '这一步正在进行中。';
    case 'retry_wait':
      return '系统正在等待下一次重试。';
    case 'cancelled':
      return '这一步已经取消。';
    default:
      return '这一步正在等待处理。';
  }
}
