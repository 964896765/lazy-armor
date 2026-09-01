export interface PresentableExecutionStep {
  stepOrder: number;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  created: '准备中', queued: '等待处理', running: '正在处理', retry_wait: '正在重试', waiting_approval: '等待确认',
  succeeded: '已完成', partially_succeeded: '部分完成', failed: '执行失败', cancelled: '已取消',
};

const STEP_MARKS: Record<string, string> = {
  succeeded: '✓', failed: '!', skipped: '○', cancelled: '○', running: '…', retry_wait: '…', pending: '○',
};

export type ExecutionListState = 'loading' | 'error' | 'empty' | 'ready';

export function executionStatusLabel(status: string) { return STATUS_LABELS[status] ?? '处理中'; }
export function executionStepMark(status: string) { return STEP_MARKS[status] ?? '○'; }
export function sortExecutionSteps<T extends PresentableExecutionStep>(steps: T[]) { return [...steps].sort((left, right) => left.stepOrder - right.stepOrder); }
export function executionListState(loading: boolean, error: boolean, count: number): ExecutionListState {
  if (loading) return 'loading';
  if (error) return 'error';
  return count === 0 ? 'empty' : 'ready';
}
