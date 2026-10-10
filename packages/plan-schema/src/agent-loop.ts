/** Read models of persistent Runtime. They never grant execution permission. */
export type AgentLoopState = 'DRAFT' | 'PAUSED' | 'ENDED' | 'WAITING_RESOURCE' | 'WAITING_CONFIRMATION' |
  'OBSERVING' | 'ACTING' | 'VERIFYING' | 'RECONCILING' | 'WAITING' | 'NEEDS_ATTENTION';
export interface AgentLoopReflection {
  executionId: string;
  planVersionId: string;
  recordedStatus: string;
  outcome: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED' | 'UNKNOWN' | 'FAILED' | 'CANCELLED';
  verifiedResultCount: number;
  evaluatedAt: string;
}
export interface AgentLoopProjection {
  schemaVersion: 'agent-loop.v1';
  planId: string;
  planVersionId: string | null;
  title: string;
  state: AgentLoopState;
  nextRunAt: string | null;
  triggerModes: string[];
  reflection: AgentLoopReflection | null;
  asOf: string;
  executionAuthorized: false;
}
export interface AgentLoopHistoryItem {
  id: string;
  kind: 'RUN' | 'CHECKPOINT';
  planVersionId: string;
  recordedAt: string;
  state: string;
  nextRunAt: string | null;
  executionId: string | null;
  reflection: AgentLoopReflection | null;
}
export function agentLoopState(input: {
  planStatus: string; resourceAvailable: boolean; approvalPending: boolean; reconciliationPending: boolean;
  runStatus?: string; outcome?: AgentLoopReflection['outcome']; observationState?: string;
}): AgentLoopState {
  if (input.planStatus === 'paused') return 'PAUSED';
  if (['archived', 'ended'].includes(input.planStatus)) return 'ENDED';
  if (input.planStatus === 'blocked') return input.resourceAvailable ? 'NEEDS_ATTENTION' : 'WAITING_RESOURCE';
  if (input.planStatus === 'degraded') return 'NEEDS_ATTENTION';
  if (input.planStatus !== 'active') return 'DRAFT';
  if (input.reconciliationPending || input.outcome === 'UNKNOWN') return 'RECONCILING';
  if (input.approvalPending || input.runStatus === 'waiting_approval') return 'WAITING_CONFIRMATION';
  if (!input.resourceAvailable || input.observationState === 'WAITING_RESOURCE') return 'WAITING_RESOURCE';
  if (input.observationState === 'WAITING_FACT_CONFIRMATION') return 'WAITING_CONFIRMATION';
  if (input.observationState === 'READ_PENDING') return 'OBSERVING';
  if (['created', 'queued', 'running', 'waiting_dispatch', 'retry_wait'].includes(input.runStatus ?? '')) return 'ACTING';
  if (input.outcome === 'UNVERIFIED') return 'VERIFYING';
  if (input.outcome === 'FAILED' || input.outcome === 'PARTIAL' || input.observationState === 'READ_FAILED') return 'NEEDS_ATTENTION';
  return 'WAITING';
}
