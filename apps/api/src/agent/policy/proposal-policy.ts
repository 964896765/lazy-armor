import type { GoalUnderstanding } from '@lazy-armor/plan-schema';
import type { PlannerResult } from '../../ai-adapter/agent-planner.service';

/** Explains the existing gates; does not grant approval or replace Runtime policy. */
export function proposalPolicy(result: PlannerResult): GoalUnderstanding['policy'] {
  const confirmationRequired = Boolean(result.pageRead) || ['PLAN_DRAFT', 'USER_EVENT_DRAFT', 'ACTION_PROPOSAL'].includes(result.result);
  return {
    confirmationRequired,
    approval: result.result === 'PLAN_DRAFT' || result.result === 'ACTION_PROPOSAL' || result.externalSync
      ? 'RUNTIME_POLICY' : 'NOT_APPLICABLE',
    executionAuthorized: false,
  };
}
