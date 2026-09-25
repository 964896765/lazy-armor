export type ConsumerOutcome = 'SUCCESS' | 'FAILED' | 'PENDING_CONFIRMATION' | 'OUTCOME_UNKNOWN';

const LABELS: Record<ConsumerOutcome, string> = {
  SUCCESS: '已完成',
  FAILED: '执行失败',
  PENDING_CONFIRMATION: '需要你确认',
  OUTCOME_UNKNOWN: '结果待确认',
};

export type ConsumerOutcomeTone = 'success' | 'warning' | 'danger' | 'neutral';

export function consumerOutcomeLabel(outcome: ConsumerOutcome | null | undefined): string {
  return outcome ? LABELS[outcome] : '处理中';
}

export function consumerOutcomeTone(outcome: ConsumerOutcome | null | undefined): ConsumerOutcomeTone {
  if (outcome === 'SUCCESS') return 'success';
  if (outcome === 'FAILED') return 'danger';
  if (outcome === 'PENDING_CONFIRMATION' || outcome === 'OUTCOME_UNKNOWN') return 'warning';
  return 'neutral';
}

/** Server-side consumer outcome projection (subset consumed by the mobile). */
export interface ConsumerOutcomeProjection {
  contractVersion: number;
  outcome: ConsumerOutcome | null;
  title: string;
  reason: string;
  actionPath: string | null;
  evidenceRefs: string[];
  completedSteps?: number | null;
  failedSteps?: number | null;
}

/** Label from the server projection; the mobile never re-derives it from raw status. */
export function consumerOutcomeProjectionLabel(projection: ConsumerOutcomeProjection | null | undefined): string {
  return projection?.title?.trim() ? projection.title : consumerOutcomeLabel(null);
}

/** Tone derived strictly from the server-provided `outcome` (null stays neutral, never success). */
export function consumerOutcomeProjectionTone(projection: ConsumerOutcomeProjection | null | undefined): ConsumerOutcomeTone {
  return consumerOutcomeTone(projection?.outcome ?? null);
}
