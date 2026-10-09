import type { PlannerResult } from '../../ai-adapter/agent-planner.service';
import type { GoalUnderstanding } from '@lazy-armor/plan-schema';

/** Classification comes from the validated planner contract, never a keyword UI guess. */
export function goalLifecycle(result: PlannerResult): GoalUnderstanding['lifecycle'] {
  switch (result.result) {
    case 'PLAN_DRAFT': return 'PERSISTENT';
    case 'USER_EVENT_DRAFT': return 'USER_EVENT';
    case 'ACTION_PROPOSAL':
    case 'ANSWER': return 'TEMPORARY';
    default: return null;
  }
}
