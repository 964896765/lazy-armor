import { Injectable } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { ExecutionEventService } from './execution-event.service';
import type { FallbackPolicySnapshot } from './execution-policy.service';

export interface FallbackOutcome {
  strategy: FallbackPolicySnapshot['strategy'];
  stepStatus: 'failed' | 'skipped';
  continueExecution: boolean;
  resultCode: string;
  resultSummary: string;
  manualInterventionRequired?: boolean;
}

@Injectable()
export class FallbackExecutor {
  constructor(private readonly events: ExecutionEventService, private readonly plans: PlansService) {}

  async execute(userId: string, planId: string, executionId: string, stepId: string, errorCode: string, policyValue: unknown): Promise<FallbackOutcome> {
    const policy = policyValue as Partial<FallbackPolicySnapshot> | null;
    const strategy = policy?.strategy;
    if (!strategy || !['fail_execution', 'skip_step', 'pause_plan', 'require_manual_intervention'].includes(strategy)) {
      await this.events.append(executionId, 'fallback_failed', { reason: 'INVALID_FALLBACK_POLICY' }, stepId);
      return { strategy: 'fail_execution', stepStatus: 'failed', continueExecution: false, resultCode: 'FALLBACK_POLICY_INVALID', resultSummary: 'Fallback policy was invalid; execution stopped safely' };
    }
    if (strategy === 'pause_plan') {
      try { await this.plans.changeStatus(userId, planId, 'paused'); } catch {
        await this.events.append(executionId, 'fallback_failed', { strategy, reason: 'PLAN_STATE_TRANSITION_REJECTED' }, stepId);
        return { strategy, stepStatus: 'failed', continueExecution: false, resultCode: 'FALLBACK_FAILED', resultSummary: 'Plan could not be paused; execution stopped safely' };
      }
    }
    const outcome: FallbackOutcome = strategy === 'skip_step'
      ? { strategy, stepStatus: 'skipped', continueExecution: true, resultCode: 'FALLBACK_STEP_SKIPPED', resultSummary: 'Failed step was skipped by fallback policy' }
      : strategy === 'require_manual_intervention'
        ? { strategy, stepStatus: 'failed', continueExecution: false, resultCode: 'MANUAL_INTERVENTION_REQUIRED', resultSummary: 'Manual intervention is required; no notification was sent', manualInterventionRequired: true }
        : strategy === 'pause_plan'
          ? { strategy, stepStatus: 'failed', continueExecution: false, resultCode: 'FALLBACK_PLAN_PAUSED', resultSummary: 'Plan was paused after action failure' }
          : { strategy, stepStatus: 'failed', continueExecution: false, resultCode: 'FALLBACK_FAIL_EXECUTION', resultSummary: 'Action failed after all retry attempts' };
    await this.events.append(executionId, 'fallback_executed', { strategy, errorCode, resultCode: outcome.resultCode }, stepId);
    return outcome;
  }
}
