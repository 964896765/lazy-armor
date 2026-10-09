import { z } from 'zod';

export const TASK_STATUSES = ['CREATED', 'READY', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  CREATED: ['READY', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  READY: ['RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  RUNNING: ['WAITING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  WAITING: ['READY', 'RUNNING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  UNKNOWN: [], SUCCESS: [], FAILED: [], CANCELLED: [],
};

/** Snapshot transitions follow the fenced Runtime, never a client-provided status. */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function taskStatusFromRuntime(input: { executionStatus: string; stepStatus?: string; errorCode?: string | null; resultState?: string | null; approvalPending?: boolean }): TaskStatus {
  if (input.resultState === 'OUTCOME_UNKNOWN' || input.errorCode === 'OUTCOME_UNKNOWN') return 'UNKNOWN';
  // A reconciled current result may differ from immutable failed Execution history.
  if (input.resultState === 'SUCCEEDED') return 'SUCCESS';
  if (input.resultState === 'FAILED') return input.executionStatus === 'cancelled' ? 'CANCELLED' : 'FAILED';
  const status = input.stepStatus ?? input.executionStatus;
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'failed' || status === 'partially_succeeded') return 'FAILED';
  if (status === 'succeeded' || status === 'skipped') return 'SUCCESS';
  if (input.approvalPending || ['waiting_approval', 'waiting_dispatch', 'retry_wait'].includes(status)) return 'WAITING';
  if (status === 'running') return 'RUNNING';
  if (status === 'queued') return 'READY';
  return 'CREATED';
}

export interface AgentTaskProjection {
  id: string;
  parentTaskId: string | null;
  executionStepId: string | null;
  title: string;
  status: TaskStatus;
  recordedStatus: TaskStatus;
  runtimeStatus: string;
  priority: number;
  dependsOn: string[];
  retryCount: number;
  skipped: boolean;
  waitReason: 'APPROVAL' | 'RUNTIME' | 'RETRY' | 'DEPENDENCY' | 'PLAN_PAUSED' | null;
}

export interface TaskGraphProjection {
  id: string;
  planId: string | null;
  planVersionId: string | null;
  executionId: string;
  status: TaskStatus;
  recordedStatus: TaskStatus;
  runtimeStatus: string;
  planPaused: boolean;
  createdAt: string;
  updatedAt: string;
  historical: boolean;
  tasks: AgentTaskProjection[];
}
