import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  actionAdapterBindings,
  actionIntents,
  approvalRequests,
  auditLogs,
  executionEvents,
  executionSteps,
  executions,
  notifications,
  reconciliationCases,
  sideEffectOperations,
  strategyRuntimeDecisions,
  strategyRuntimeWakeups,
  verificationEvidence,
} from '@lazy-armor/database';
import {
  buildLifecycleReadProjection,
  type LifecycleReadObservation,
} from '@lazy-armor/plan-schema';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

/**
 * Read model only. It intentionally does not run, repair, retry, or infer an
 * execution stage. A stage is populated only when its backing runtime record
 * exists; absent stage evidence remains NOT_REACHED.
 */
@Injectable()
export class LifecycleReadService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async forPlan(userId: string, planId: string) {
    const latest = (await this.db.select({ id: executions.id })
      .from(executions)
      .where(and(eq(executions.userId, userId), eq(executions.planId, planId)))
      .orderBy(desc(executions.createdAt), desc(executions.id))
      .limit(1))[0];
    // PlansController establishes ownership first. A real Plan without an
    // Execution has no observed runtime stage, so every step stays NOT_REACHED.
    if (!latest) return { subject: { type: 'plan' as const, id: planId, executionId: null }, lifecycle: buildLifecycleReadProjection() };
    const lifecycle = await this.forExecution(userId, latest.id);
    return { subject: { type: 'plan' as const, id: planId, executionId: latest.id }, lifecycle: lifecycle.lifecycle };
  }

  async forExecution(userId: string, executionId: string) {
    const execution = (await this.db.select({
      id: executions.id,
      triggerType: executions.triggerType,
      status: executions.status,
      approvalStatus: executions.approvalStatus,
      resolvedRiskSnapshotJson: executions.resolvedRiskSnapshotJson,
      resultCode: executions.resultCode,
    }).from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.userId, userId)))
      .limit(1))[0];
    if (!execution) throw new NotFoundException('Execution not found');

    const [steps, cases, evidence, approvals, events, bindings, notices, audits, wakeup] = await Promise.all([
      this.db.select({
        status: executionSteps.status,
        dispatchStatus: executionSteps.dispatchStatus,
        approvalGateStatus: executionSteps.approvalGateStatus,
        riskSnapshotJson: executionSteps.riskSnapshotJson,
      }).from(executionSteps).where(eq(executionSteps.executionId, executionId)),
      this.db.select({ status: reconciliationCases.status, resultState: reconciliationCases.resultState })
        .from(reconciliationCases).where(and(eq(reconciliationCases.executionId, executionId), eq(reconciliationCases.userId, userId))),
      this.db.select({ operationId: verificationEvidence.operationId, resultState: verificationEvidence.resultState, verifiedAt: verificationEvidence.verifiedAt })
        .from(verificationEvidence)
        .innerJoin(sideEffectOperations, eq(verificationEvidence.operationId, sideEffectOperations.id))
        .where(and(eq(verificationEvidence.userId, userId), eq(sideEffectOperations.executionId, executionId), eq(sideEffectOperations.userId, userId)))
        .orderBy(desc(verificationEvidence.verifiedAt)),
      this.db.select({ status: approvalRequests.status, decision: approvalRequests.decision })
        .from(approvalRequests).where(and(eq(approvalRequests.executionId, executionId), eq(approvalRequests.userId, userId))),
      this.db.select({ eventType: executionEvents.eventType })
        .from(executionEvents).where(eq(executionEvents.executionId, executionId)),
      this.db.select({ status: actionAdapterBindings.status })
        .from(actionAdapterBindings)
        .innerJoin(actionIntents, eq(actionAdapterBindings.actionIntentId, actionIntents.id))
        .where(and(eq(actionIntents.executionId, executionId), eq(actionIntents.userId, userId))),
      this.db.select({ status: notifications.status })
        .from(notifications).where(and(eq(notifications.executionId, executionId), eq(notifications.userId, userId))),
      this.db.select({ result: auditLogs.result })
        .from(auditLogs).where(and(eq(auditLogs.executionId, executionId), eq(auditLogs.userId, userId))),
      this.db.select({ id: strategyRuntimeWakeups.id })
        .from(strategyRuntimeWakeups)
        .where(and(eq(strategyRuntimeWakeups.handoffExecutionId, executionId), eq(strategyRuntimeWakeups.userId, userId)))
        .limit(1),
    ]);

    const observations = new Map<LifecycleReadObservation['key'], LifecycleReadObservation>();
    const observe = (observation: LifecycleReadObservation | null) => {
      if (observation) observations.set(observation.key, observation);
    };

    if (wakeup[0]) {
      const decision = (await this.db.select({ lifecycleTraceJson: strategyRuntimeDecisions.lifecycleTraceJson })
        .from(strategyRuntimeDecisions)
        .where(and(eq(strategyRuntimeDecisions.wakeupId, wakeup[0].id), eq(strategyRuntimeDecisions.userId, userId)))
        .limit(1))[0];
      for (const observation of strategyTraceObservations(decision?.lifecycleTraceJson)) observe(observation);
    }

    // These stages all have direct immutable/persisted backing records.
    observe({ key: 'TRIGGER', state: 'SUCCEEDED', reason: execution.triggerType === 'manual' ? 'MANUAL_EXECUTION_PERSISTED' : 'EXECUTION_TRIGGER_PERSISTED' });
    if (events.some((row) => row.eventType === 'conditions_met')) observe({ key: 'CONDITION', state: 'SUCCEEDED', reason: 'CONDITIONS_MET_EVENT' });
    else if (events.some((row) => row.eventType === 'conditions_not_met')) observe({ key: 'CONDITION', state: 'SKIPPED', reason: 'CONDITIONS_NOT_MET_EVENT' });
    if (execution.resolvedRiskSnapshotJson || steps.some((row) => row.riskSnapshotJson)) observe({ key: 'RISK', state: 'SUCCEEDED', reason: 'RISK_SNAPSHOT_PERSISTED' });
    observe(approvalObservation(approvals, steps.map((row) => row.approvalGateStatus), execution.approvalStatus));
    if (bindings.length > 0) observe({ key: 'CAPABILITY_RESOLUTION', state: bindings.every((row) => row.status === 'BOUND') ? 'SUCCEEDED' : 'UNKNOWN', reason: 'ACTION_ADAPTER_BINDING_PERSISTED' });

    const executionStage = actionStage(steps);
    if (executionStage) observe({ key: 'EXECUTION', ...executionStage });

    const verificationStage = resultStage(latestEvidenceStates(evidence), 'VERIFICATION_EVIDENCE');
    if (verificationStage) observe({ key: 'VERIFICATION', ...verificationStage });

    const reconciliationStage = reconciliationObservation(cases, events.map((row) => row.eventType));
    if (reconciliationStage) observe({ key: 'FALLBACK_RECONCILIATION', ...reconciliationStage });

    const result = executionResultObservation(execution.status, execution.resultCode, cases);
    if (result) observe({ key: 'RESULT', ...result });
    if (notices.length > 0 || audits.length > 0) observe({ key: 'RECORD_AUDIT', state: 'SUCCEEDED', reason: audits.length > 0 ? 'AUDIT_RECORD_PERSISTED' : 'NOTIFICATION_RECORD_PERSISTED' });

    return {
      subject: { type: 'execution' as const, id: executionId },
      lifecycle: buildLifecycleReadProjection([...observations.values()]),
    };
  }
}

type StageObservation = Omit<LifecycleReadObservation, 'key'>;

function actionStage(rows: Array<{ status: string; dispatchStatus: string | null }>): StageObservation | null {
  if (rows.length === 0) return null;
  if (rows.some((row) => row.dispatchStatus === 'outcome_unknown')) return { state: 'OUTCOME_UNKNOWN', reason: 'SIDE_EFFECT_OUTCOME_UNKNOWN' };
  if (rows.some((row) => row.status === 'failed')) return { state: 'FAILED', reason: 'EXECUTION_STEP_FAILED' };
  if (rows.some((row) => row.status === 'running' || row.status === 'retry_wait' || row.status === 'waiting_dispatch')) return { state: 'RUNNING', reason: 'EXECUTION_STEP_IN_PROGRESS' };
  if (rows.every((row) => row.status === 'skipped' || row.status === 'cancelled')) return { state: 'SKIPPED', reason: 'ALL_EXECUTION_STEPS_SKIPPED_OR_CANCELLED' };
  if (rows.every((row) => row.status === 'succeeded')) return { state: 'SUCCEEDED', reason: 'ALL_EXECUTION_STEPS_SUCCEEDED' };
  return null;
}

function latestEvidenceStates(rows: Array<{ operationId: string; resultState: string; verifiedAt: Date }>): string[] {
  const latest = new Map<string, string>();
  for (const row of rows) if (!latest.has(row.operationId)) latest.set(row.operationId, row.resultState);
  return [...latest.values()];
}

function resultStage(states: string[], reason: string): StageObservation | null {
  if (states.length === 0) return null;
  if (states.includes('OUTCOME_UNKNOWN')) return { state: 'OUTCOME_UNKNOWN', reason };
  if (states.includes('FAILED')) return { state: 'FAILED', reason };
  if (states.includes('PARTIALLY_SUCCEEDED')) return { state: 'UNKNOWN', reason };
  if (states.every((state) => state === 'SUCCEEDED')) return { state: 'SUCCEEDED', reason };
  return { state: 'UNKNOWN', reason };
}

function reconciliationObservation(rows: Array<{ status: string; resultState: string }>, events: string[]): StageObservation | null {
  if (rows.length === 0) {
    if (events.includes('fallback_failed')) return { state: 'FAILED', reason: 'FALLBACK_FAILED_EVENT' };
    if (events.includes('fallback_executed')) return { state: 'SUCCEEDED', reason: 'FALLBACK_EXECUTED_EVENT' };
    return null;
  }
  if (rows.some((row) => row.status === 'NEEDS_USER')) return { state: 'OUTCOME_UNKNOWN', reason: 'RECONCILIATION_NEEDS_USER' };
  if (rows.some((row) => row.status === 'OPEN' || row.status === 'RECONCILING')) return { state: 'RUNNING', reason: 'RECONCILIATION_PENDING' };
  return resultStage(rows.map((row) => row.resultState), 'RECONCILIATION_RESOLVED');
}

function approvalObservation(rows: Array<{ status: string; decision: string | null }>, gates: Array<string | null>, executionStatus: string): LifecycleReadObservation | null {
  if (rows.some((row) => row.status === 'pending')) return { key: 'APPROVAL', state: 'RUNNING', reason: 'APPROVAL_REQUEST_PENDING' };
  if (rows.some((row) => row.status === 'rejected' || row.decision === 'rejected')) return { key: 'APPROVAL', state: 'BLOCKED', reason: 'APPROVAL_REJECTED' };
  if (rows.some((row) => row.status === 'approved' || row.decision === 'approved')) return { key: 'APPROVAL', state: 'SUCCEEDED', reason: 'APPROVAL_GRANTED' };
  if (rows.some((row) => ['cancelled', 'expired'].includes(row.status))) return { key: 'APPROVAL', state: 'SKIPPED', reason: 'APPROVAL_CLOSED_WITHOUT_GRANT' };
  if (gates.length > 0 && gates.every((gate) => gate === 'not_required' || gate === 'authorized')) return { key: 'APPROVAL', state: 'SKIPPED', reason: 'APPROVAL_NOT_REQUIRED_OR_PREAUTHORIZED' };
  if (executionStatus === 'pending') return { key: 'APPROVAL', state: 'RUNNING', reason: 'EXECUTION_APPROVAL_PENDING' };
  return null;
}

function strategyTraceObservations(value: unknown): LifecycleReadObservation[] {
  if (!Array.isArray(value)) return [];
  const states: Record<string, LifecycleReadObservation['state'] | undefined> = {
    SUCCEEDED: 'SUCCEEDED', SKIPPED: 'SKIPPED', BLOCKED: 'BLOCKED', FAILED: 'FAILED',
    RUNNING: 'RUNNING', UNKNOWN: 'UNKNOWN', OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  };
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { key?: unknown; state?: unknown; reason?: unknown };
    const state = typeof row.state === 'string' ? states[row.state] : undefined;
    if (!state || typeof row.key !== 'string') return [];
    return [{ key: row.key as LifecycleReadObservation['key'], state, reason: typeof row.reason === 'string' ? row.reason : 'STRATEGY_LIFECYCLE_TRACE' }];
  });
}

function executionResultObservation(status: string, resultCode: string | null, cases: Array<{ status: string; resultState: string }>): StageObservation | null {
  if (cases.some((row) => row.status !== 'RESOLVED' && row.resultState === 'OUTCOME_UNKNOWN')) return { state: 'OUTCOME_UNKNOWN', reason: 'OUTCOME_UNKNOWN' };
  if (cases.length > 0 && cases.every((row) => row.status === 'RESOLVED')) return resultStage(cases.map((row) => row.resultState), 'RECONCILIATION_RESULT');
  if (resultCode === 'OUTCOME_UNKNOWN') return { state: 'OUTCOME_UNKNOWN', reason: 'OUTCOME_UNKNOWN' };
  switch (status) {
    case 'succeeded': return { state: 'SUCCEEDED', reason: 'EXECUTION_TERMINAL_STATUS' };
    case 'failed': return { state: 'FAILED', reason: 'EXECUTION_TERMINAL_STATUS' };
    case 'cancelled': return { state: 'SKIPPED', reason: 'EXECUTION_CANCELLED' };
    case 'partially_succeeded': return { state: 'UNKNOWN', reason: 'EXECUTION_PARTIALLY_SUCCEEDED' };
    case 'running': case 'queued': case 'retry_wait': case 'waiting_approval': case 'waiting_dispatch': return { state: 'RUNNING', reason: 'EXECUTION_IN_PROGRESS' };
    default: return null;
  }
}
