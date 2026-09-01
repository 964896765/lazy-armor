export const EXECUTION_STATES = ['created', 'queued', 'running', 'retry_wait', 'waiting_approval', 'waiting_dispatch', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'] as const;
export type ExecutionStatus = typeof EXECUTION_STATES[number];
export const EXECUTION_TERMINAL_STATES = new Set<ExecutionStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled']);

export const STEP_STATES = ['pending', 'running', 'waiting_dispatch', 'retry_wait', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;
export type ExecutionStepStatus = typeof STEP_STATES[number];
export const STEP_TERMINAL_STATES = new Set<ExecutionStepStatus>(['succeeded', 'failed', 'skipped', 'cancelled']);

export const DISPATCH_STATES = ['prepared', 'queued', 'executing', 'succeeded', 'failed', 'outcome_unknown', 'cancelled', 'retry_wait'] as const;
export type DispatchStatus = typeof DISPATCH_STATES[number];

export const RETRYABLE_ERROR_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'TEMPORARY_UNAVAILABLE', 'CONNECTOR_TEMPORARY_ERROR']);

export class ExecutionRuntimeError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = 'ExecutionRuntimeError';
  }
}

export function asRuntimeError(error: unknown): ExecutionRuntimeError {
  if (error instanceof ExecutionRuntimeError) return error;
  // 结构化回退：跨模块边界（如 Connector 抛出的同构错误）时仍保留错误码。
  const candidate = error as Partial<ExecutionRuntimeError>;
  if (error instanceof Error && typeof candidate.code === 'string' && typeof candidate.retryable === 'boolean') {
    return new ExecutionRuntimeError(candidate.code, error.message, candidate.retryable);
  }
  return new ExecutionRuntimeError('INTERNAL_EXECUTION_ERROR', error instanceof Error ? error.message : 'Execution failed');
}

export interface RunnerOutcome {
  status: ExecutionStatus;
  retryScheduled?: boolean;
}
