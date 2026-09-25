import type { RuntimeResultState } from './verification-runtime';

export const CONSUMER_OUTCOME_VERSION = 1 as const;

/**
 * User-facing execution outcome. These four states are a read-only projection
 * over the internal execution/verification/reconciliation authorities; they
 * never replace those state machines.
 *
 * "Not yet determined" (no terminal result, e.g. not yet run, still processing,
 * data not yet acquired, source offline) is expressed as `outcome: null`, NOT
 * as FAILED. The business state of a subject (e.g. a shipment's delivery state)
 * is a fact, separate from whether the plan's own action succeeded.
 */
export const CONSUMER_OUTCOMES = ['SUCCESS', 'FAILED', 'PENDING_CONFIRMATION', 'OUTCOME_UNKNOWN'] as const;
export type ConsumerOutcome = typeof CONSUMER_OUTCOMES[number];

export type ConsumerOutcomeActionPath = '/records' | '/approvals' | '/today' | null;

export interface ConsumerOutcomeProjection {
  contractVersion: typeof CONSUMER_OUTCOME_VERSION;
  outcome: ConsumerOutcome | null;
  title: string;
  reason: string;
  actionPath: ConsumerOutcomeActionPath;
  evidenceRefs: readonly string[];
}

export interface ConsumerOutcomeEvidence {
  /** execution.status (lowercase internal state). */
  executionStatus: string | null;
  /** execution.approvalStatus, or null when no approval applies. */
  approvalStatus: string | null;
  /** Folded runtime result state from the reconciliation authority. */
  resultState: RuntimeResultState | null;
  /** True when an OPEN or RECONCILING reconciliation case still exists. */
  reconciliationOpen: boolean;
  /** True when a NEEDS_USER reconciliation case awaits the user. */
  reconciliationNeedsUser: boolean;
}

export function projectConsumerOutcome(input: ConsumerOutcomeEvidence): ConsumerOutcomeProjection {
  if (input.approvalStatus === 'pending' || input.executionStatus === 'waiting_approval') {
    return freeze({
      contractVersion: CONSUMER_OUTCOME_VERSION,
      outcome: 'PENDING_CONFIRMATION',
      title: '需要你确认',
      reason: '执行前需要你确认或授权，尚未开始。',
      actionPath: '/approvals',
      evidenceRefs: input.executionStatus ? [`execution:${input.executionStatus}`] : [],
    });
  }
  if (input.resultState === 'OUTCOME_UNKNOWN' || input.reconciliationNeedsUser || input.reconciliationOpen) {
    return freeze({
      contractVersion: CONSUMER_OUTCOME_VERSION,
      outcome: 'OUTCOME_UNKNOWN',
      title: '结果待确认',
      reason: '操作已发出，但结果暂时无法确认；系统只做只读回查，不会重复执行。',
      actionPath: '/records',
      evidenceRefs: ['reconciliation:unknown'],
    });
  }
  if (input.resultState === 'FAILED') {
    return freeze({
      contractVersion: CONSUMER_OUTCOME_VERSION,
      outcome: 'FAILED',
      title: '执行失败',
      reason: '计划执行没有完成。',
      actionPath: '/records',
      evidenceRefs: ['verification:failed'],
    });
  }
  if (input.resultState === 'SUCCEEDED') {
    return freeze({
      contractVersion: CONSUMER_OUTCOME_VERSION,
      outcome: 'SUCCESS',
      title: '已完成',
      reason: '计划已执行并验证成功。',
      actionPath: '/records',
      evidenceRefs: ['verification:succeeded'],
    });
  }
  if (input.resultState === 'PARTIALLY_SUCCEEDED') {
    return freeze({
      contractVersion: CONSUMER_OUTCOME_VERSION,
      outcome: 'FAILED',
      title: '部分完成',
      reason: '计划只完成了一部分，未全部成功。',
      actionPath: '/records',
      evidenceRefs: ['verification:partially_succeeded'],
    });
  }
  return freeze({
    contractVersion: CONSUMER_OUTCOME_VERSION,
    outcome: null,
    title: '尚未有结果',
    reason: '计划尚未执行或仍在处理中。',
    actionPath: null,
    evidenceRefs: [],
  });
}

export function isConsumerOutcomeProjection(value: unknown): value is ConsumerOutcomeProjection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConsumerOutcomeProjection>;
  return candidate.contractVersion === CONSUMER_OUTCOME_VERSION
    && (candidate.outcome === null || CONSUMER_OUTCOMES.includes(candidate.outcome as ConsumerOutcome))
    && typeof candidate.title === 'string'
    && typeof candidate.reason === 'string'
    && (candidate.actionPath === null || candidate.actionPath === '/records'
      || candidate.actionPath === '/approvals' || candidate.actionPath === '/today')
    && Array.isArray(candidate.evidenceRefs);
}

function freeze<T extends ConsumerOutcomeProjection>(value: T): T {
  return Object.freeze({ ...value, evidenceRefs: Object.freeze([...value.evidenceRefs]) });
}
