import { Inject, Injectable } from '@nestjs/common';
import { executionSteps, executions, planActions, plans } from '@lazy-armor/database';
import type { NormalizedAction } from '@lazy-armor/plan-schema';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';
import { PlansService } from '../plans/plans.service';
import { ActionExecutor } from './action-executor.service';
import { ConditionEvaluator } from './condition-evaluator.service';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionLeaseService } from './execution-lease.service';
import { ExecutionResultResolver } from './execution-result-resolver.service';
import { ExecutionStateService } from './execution-state.service';
import { ExecutionStepStateService } from './execution-step-state.service';
import { asRuntimeError, EXECUTION_TERMINAL_STATES, type ExecutionStatus, type RunnerOutcome } from './execution.types';
import { FallbackExecutor } from './fallback-executor.service';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { SourceResolver } from './source-resolver.service';
import { ExecutionApprovalGate } from './execution-approval-gate.service';
import { SideEffectCoordinator } from './side-effect/side-effect-coordinator.service';
import { NotificationService } from '../notifications/notification.service';

const BLOCKING_CODES = new Set(['CONNECTION_REVOKED', 'CONNECTION_EXPIRED', 'PERMISSION_REVOKED', 'PERMISSION_EXPIRED', 'CAPABILITY_NOT_GRANTED', 'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED']);

@Injectable()
export class ExecutionRunner {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly assembler: PlanDefinitionAssembler,
    private readonly plansService: PlansService,
    private readonly sources: SourceResolver,
    private readonly conditions: ConditionEvaluator,
    private readonly actions: ActionExecutor,
    private readonly policy: ExecutionPolicyService,
    private readonly lease: ExecutionLeaseService,
    private readonly resultResolver: ExecutionResultResolver,
    private readonly fallback: FallbackExecutor,
    private readonly states: ExecutionStateService,
    private readonly stepStates: ExecutionStepStateService,
    private readonly events: ExecutionEventService,
    private readonly sanitizer: SnapshotSanitizer,
    private readonly approvalGate: ExecutionApprovalGate,
    private readonly notifications: NotificationService,
    private readonly coordinator: SideEffectCoordinator,
  ) {}

  async run(executionId: string, workerToken: string): Promise<RunnerOutcome> {
    if (!(await this.lease.heartbeat(executionId, workerToken))) return { status: 'queued' };
    let execution = await this.load(executionId);
    if (EXECUTION_TERMINAL_STATES.has(execution.status as ExecutionStatus)) return { status: execution.status as ExecutionStatus };
    if (execution.status === 'created') await this.states.transition(executionId, 'queued', { queuedAt: new Date() });
    execution = await this.load(executionId);
    if (execution.cancellationRequestedAt) return this.cancelAtBoundary(executionId, execution.status as ExecutionStatus, 0);
    if (!['queued', 'retry_wait', 'running'].includes(execution.status)) return this.fail(executionId, execution.status as ExecutionStatus, 'INVALID_EXECUTION_STATE', 'Execution cannot be started from its current state');
    if (execution.status !== 'running') await this.states.transition(executionId, 'running', { startedAt: execution.startedAt ?? new Date() });

    try {
      if (execution.planStatus !== 'active') return this.cancelAtBoundary(executionId, 'running', await this.successCount(executionId), 'PLAN_NOT_ACTIVE');
      const assembled = await this.assembler.assembleById(execution.userId, execution.planId, execution.planVersionId);
      if (assembled.version.planId !== execution.planId || assembled.computedHash !== execution.definitionHash || assembled.version.definitionHash !== execution.definitionHash) {
        return this.fail(executionId, 'running', 'PLAN_DEFINITION_INTEGRITY_ERROR', 'Plan Definition integrity verification failed');
      }

      const existing = await this.db.select().from(executionSteps).where(eq(executionSteps.executionId, executionId)).orderBy(asc(executionSteps.stepOrder));
      const initialRun = existing.every((step) => step.attemptCount === 0);
      let context: Record<string, unknown>;
      try {
        context = await this.sources.resolve(execution.userId, assembled.definition.sources, { ...execution.triggerPayloadJson, planId: execution.planId }, execution.requestId);
        context = { ...context, planId: execution.planId };
        if (initialRun) {
          const conditionsMet = this.conditions.evaluate(assembled.definition.conditions, context);
          await this.events.append(executionId, conditionsMet ? 'conditions_met' : 'conditions_not_met', { conditionsMet });
          if (!conditionsMet) {
            for (const step of existing) await this.stepStates.transition(step.id, 'skipped', { errorCode: 'SKIPPED_BY_CONDITION', finishedAt: new Date() });
            await this.states.transition(executionId, 'succeeded', { resultCode: 'CONDITIONS_NOT_MET', resultSummary: 'Conditions were not met; no action was executed', finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
            return { status: 'succeeded' };
          }
        }
      } catch (error) {
        const mapped = asRuntimeError(error);
        return this.fail(executionId, 'running', mapped.code, this.sanitizer.sanitizeText(mapped));
      }

      const actionRows = await this.db.select().from(planActions).where(eq(planActions.planVersionId, execution.planVersionId)).orderBy(asc(planActions.stepOrder));
      for (const [index, actionDefinition] of assembled.definition.actions.entries()) {
        if (!(await this.lease.heartbeat(executionId, workerToken))) return { status: 'running' };
        const planAction = actionRows[index];
        if (!planAction || planAction.stepOrder !== actionDefinition.stepOrder) return this.fail(executionId, 'running', 'PLAN_DEFINITION_INTEGRITY_ERROR', 'Plan Action order is inconsistent');
        execution = await this.load(executionId);
        const succeeded = await this.successCount(executionId);
        if (execution.cancellationRequestedAt) return this.cancelAtBoundary(executionId, 'running', succeeded);
        if (execution.planStatus !== 'active') return this.cancelAtBoundary(executionId, 'running', succeeded, 'PLAN_NOT_ACTIVE');

        let step = (await this.db.select().from(executionSteps).where(and(eq(executionSteps.executionId, executionId), eq(executionSteps.stepOrder, actionDefinition.stepOrder))).limit(1))[0];
        if (step?.status === 'succeeded') continue;
        if (!step) return this.fail(executionId, 'running', 'PLAN_DEFINITION_INTEGRITY_ERROR', 'ExecutionStep snapshot is missing');

        const gate = await this.approvalGate.check({ execution, step, action: actionDefinition as NormalizedAction });
        if (!gate.allowed) return { status: 'waiting_approval' };

        // §15：外部副作用（externalEffect / 动态 R3-R4）走 SideEffect Pipeline；
        // R0-R2 内部安全动作继续由 ActionExecutor 直接运行。
        if (await this.coordinator.isSideEffectAction(actionDefinition as NormalizedAction, gate.effectiveRisk, null)) {
          const prepared = await this.coordinator.prepare({ execution, step: { ...step, inputFingerprint: step.inputFingerprint! }, action: actionDefinition as NormalizedAction, effectiveRisk: gate.effectiveRisk });
          await this.states.transition(executionId, 'waiting_dispatch', { workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
          await this.events.append(executionId, 'execution_waiting_dispatch', { operationId: prepared.operationId }, step.id);
          return { status: 'waiting_dispatch' };
        }

        const attempt = step.attemptCount + 1;
        await this.stepStates.transition(step.id, 'running', { attemptCount: attempt, startedAt: step.startedAt ?? new Date(), nextRetryAt: null, errorCode: null, errorMessage: null });
        await this.events.append(executionId, 'step_attempt_started', { attempt }, step.id);
        try {
          const output = await this.actions.execute(execution.userId, executionId, actionDefinition as NormalizedAction, context, gate.effectiveRisk);
          context = { ...context, ...output };
          await this.stepStates.transition(step.id, 'succeeded', { outputSnapshotJson: this.sanitizer.sanitize(output), finishedAt: new Date() });
          await this.events.append(executionId, 'step_succeeded', { attempt }, step.id);
        } catch (error) {
          const mapped = asRuntimeError(error);
          const safeMessage = this.sanitizer.sanitizeText(mapped);
          if (BLOCKING_CODES.has(mapped.code)) {
            try { await this.plansService.changeStatus(execution.userId, execution.planId, 'blocked'); } catch { /* another state change won the race */ }
            await this.events.append(executionId, 'plan_block_requested', { errorCode: mapped.code }, step.id);
          }
          const retryPolicy = this.policy.resolveRetry(execution.resolvedRetryPolicyJson);
          if (mapped.retryable && retryPolicy.retryableErrorCodes.includes(mapped.code) && attempt < retryPolicy.maxAttempts) {
            const retryCount = step.retryCount + 1;
            const nextRetryAt = new Date(Date.now() + this.policy.delayForRetry(retryCount, retryPolicy));
            await this.stepStates.transition(step.id, 'retry_wait', { retryCount, nextRetryAt, errorCode: mapped.code, errorMessage: safeMessage });
            await this.states.transition(executionId, 'retry_wait', { errorCode: mapped.code, errorMessage: safeMessage, workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
            await this.events.append(executionId, 'retry_scheduled', { attempt, retryCount, nextRetryAt: nextRetryAt.toISOString(), errorCode: mapped.code }, step.id);
            return { status: 'retry_wait', retryScheduled: true };
          }
          const fallback = await this.fallback.execute(execution.userId, execution.planId, executionId, step.id, mapped.code, execution.resolvedFallbackPolicyJson);
          await this.stepStates.transition(step.id, fallback.stepStatus, { errorCode: mapped.code, errorMessage: safeMessage, fallbackResultJson: this.sanitizer.sanitize(fallback), finishedAt: new Date() });
          if (fallback.continueExecution) continue;
          const completed = await this.successCount(executionId);
          const finalStatus = completed > 0 ? 'partially_succeeded' : 'failed';
          await this.states.transition(executionId, finalStatus, { resultCode: fallback.resultCode, resultSummary: fallback.resultSummary, errorCode: mapped.code, errorMessage: safeMessage, finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
          if (mapped.code === 'SAFETY_GATE_REQUIRES_APPROVAL_AND_IDEMPOTENCY') await this.notifications.emit({ userId: execution.userId, executionId, priority: 'P0', eventType: 'p0_7_safety_gate_blocked', dedupeKey: `safety-gate:${step.id}`, title: '高风险动作已安全阻断', body: '你已批准该动作，但在业务幂等和事务发件箱完成前，系统不会执行真实外部副作用。' });
          return { status: finalStatus };
        }
      }
      const finalSteps = await this.db.select({ status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.executionId, executionId));
      const finalStatus = this.resultResolver.resolve(finalSteps);
      const resultSummary = typeof context.resultSummary === 'string'
        ? context.resultSummary
        : typeof context.humanSummary === 'string'
          ? context.humanSummary
          : finalStatus === 'succeeded'
            ? 'All actions completed successfully'
            : 'Execution completed with skipped or failed steps';
      await this.states.transition(executionId, finalStatus, { resultCode: finalStatus === 'succeeded' ? 'EXECUTION_COMPLETED' : 'EXECUTION_PARTIALLY_COMPLETED', resultSummary, errorCode: null, errorMessage: null, finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
      return { status: finalStatus };
    } catch (error) {
      const latest = await this.load(executionId);
      if (EXECUTION_TERMINAL_STATES.has(latest.status as ExecutionStatus)) return { status: latest.status as ExecutionStatus };
      const mapped = asRuntimeError(error);
      return this.fail(executionId, 'running', mapped.code, this.sanitizer.sanitizeText(mapped));
    }
  }

  private async load(id: string) {
    const rows = await this.db.select({
      id: executions.id, userId: executions.userId, planId: executions.planId, planVersionId: executions.planVersionId,
      definitionHash: executions.definitionHash, requestId: executions.requestId, triggerPayloadJson: executions.triggerPayloadJson,
      status: executions.status, cancellationRequestedAt: executions.cancellationRequestedAt, startedAt: executions.startedAt,
      planStatus: plans.status,
      resolvedRetryPolicyJson: executions.resolvedRetryPolicyJson,
      resolvedFallbackPolicyJson: executions.resolvedFallbackPolicyJson,
      resolvedApprovalPolicyJson: executions.resolvedApprovalPolicyJson,
    }).from(executions).innerJoin(plans, and(eq(executions.planId, plans.id), eq(executions.userId, plans.userId))).where(eq(executions.id, id)).limit(1);
    if (!rows[0]) throw new Error('Execution ownership or Plan relation is invalid');
    return rows[0];
  }

  private async successCount(id: string) {
    const rows = await this.db.select({ id: executionSteps.id }).from(executionSteps).where(and(eq(executionSteps.executionId, id), eq(executionSteps.status, 'succeeded')));
    return rows.length;
  }

  private async cancelAtBoundary(id: string, current: ExecutionStatus, succeeded: number, code = 'CANCELLED_BY_USER'): Promise<RunnerOutcome> {
    const status = succeeded > 0 ? 'partially_succeeded' : 'cancelled';
    await this.states.transition(id, status, { resultCode: code, resultSummary: succeeded > 0 ? 'Stopped after completing earlier steps' : 'Stopped before executing an action', finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
    return { status };
  }

  private async fail(id: string, current: ExecutionStatus, code: string, message: string): Promise<RunnerOutcome> {
    if (EXECUTION_TERMINAL_STATES.has(current)) return { status: current };
    await this.states.transition(id, 'failed', { errorCode: code, errorMessage: this.sanitizer.sanitizeText(message), resultCode: code, resultSummary: 'Execution failed safely', finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
    return { status: 'failed' };
  }
}
