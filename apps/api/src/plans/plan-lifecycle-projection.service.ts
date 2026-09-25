import { Inject, Injectable } from '@nestjs/common';
import {
  approvalRequests,
  executions,
  plans,
  planVersions,
  strategyRuntimeBindings,
  strategyRuntimeDecisions,
} from '@lazy-armor/database';
import {
  buildPlanLifecycleProjection,
  scenarioByKey,
  type PlanLifecycleObservation,
} from '@lazy-armor/plan-schema';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';

/**
 * Outer 17-step consumer projection. This service only reads the existing
 * Plan/Truth/Decision/Execution authorities and never mutates their state.
 */
@Injectable()
export class PlanLifecycleProjectionService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly readiness: ReadinessEvidenceService,
  ) {}

  async forPlan(userId: string, planId: string) {
    const plan = (await this.db.select({
      id: plans.id,
      status: plans.status,
      currentVersionId: plans.currentVersionId,
      activeVersionId: plans.activeVersionId,
    }).from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1))[0]!;
    const planVersionId = plan.currentVersionId ?? plan.activeVersionId;
    if (!planVersionId) return buildPlanLifecycleProjection({ planId, evaluatedAt: new Date().toISOString() });

    const [version, binding, latestExecution] = await Promise.all([
      this.db.select({ id: planVersions.id, domain: planVersions.domain, name: planVersions.name })
        .from(planVersions).where(and(eq(planVersions.id, planVersionId), eq(planVersions.planId, planId))).limit(1).then((rows) => rows[0]),
      this.db.select({ id: strategyRuntimeBindings.id, scenarioKey: strategyRuntimeBindings.scenarioKey })
        .from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.planVersionId, planVersionId), eq(strategyRuntimeBindings.userId, userId))).limit(1).then((rows) => rows[0]),
      this.db.select({ id: executions.id, status: executions.status, resultCode: executions.resultCode })
        .from(executions).where(and(eq(executions.planId, planId), eq(executions.userId, userId)))
        .orderBy(desc(executions.createdAt), desc(executions.id)).limit(1).then((rows) => rows[0]),
    ]);
    const scenario = binding ? scenarioByKey(binding.scenarioKey) : null;
    const runtime = scenario ? await this.readiness.projectScenarioRuntimeEvidence(userId, scenario) : null;
    const [decisions, approvals] = await Promise.all([
      binding ? this.db.select({ id: strategyRuntimeDecisions.id, result: strategyRuntimeDecisions.result })
        .from(strategyRuntimeDecisions).where(and(eq(strategyRuntimeDecisions.bindingId, binding.id), eq(strategyRuntimeDecisions.userId, userId)))
        .orderBy(desc(strategyRuntimeDecisions.evaluatedAt)).limit(1) : Promise.resolve([]),
      latestExecution ? this.db.select({ id: approvalRequests.id, status: approvalRequests.status })
        .from(approvalRequests).where(and(eq(approvalRequests.executionId, latestExecution.id), eq(approvalRequests.userId, userId))) : Promise.resolve([]),
    ]);

    const observations: PlanLifecycleObservation[] = [];
    const observe = (key: PlanLifecycleObservation['key'], state: PlanLifecycleObservation['state'], reasonCode: string, evidenceRefs: string[] = []) => {
      observations.push({ key, state, reasonCode, evidenceRefs });
    };
    if (version) observe('DOMAIN', 'COMPLETED', 'PLAN_VERSION_DOMAIN_PERSISTED', [`plan-version:${version.id}`]);
    if (scenario && binding) {
      observe('SCENARIO', 'COMPLETED', 'SCENARIO_RUNTIME_BINDING_PERSISTED', [`strategy-binding:${binding.id}`]);
      observe('REQUIREMENTS', 'COMPLETED', 'VERSIONED_SCENARIO_CONTRACT_LOADED', [`scenario:${scenario.key}@${scenario.revision}`]);
      observe('CAPABILITY_DISCOVERY', 'COMPLETED', 'USER_RUNTIME_EVIDENCE_EVALUATED', [`scenario:${scenario.key}@${scenario.revision}`]);
    } else observe('SCENARIO', 'BLOCKED', 'SCENARIO_RUNTIME_BINDING_MISSING');

    // Existing PlanVersion has only name/description, not a versioned GoalSpec + ResourceSubject.
    observe('GOAL_OBJECT', 'BLOCKED', 'GOAL_SPEC_OR_RESOURCE_SUBJECT_NOT_VERSIONED', [`plan-version:${planVersionId}`]);
    if (runtime) {
      const readinessState = runtime.product.userReadiness === 'READY' ? 'COMPLETED'
        : runtime.product.userReadiness === 'NEEDS_CONFIRMATION' ? 'READY' : 'BLOCKED';
      observe('READINESS', readinessState, runtime.product.userReadiness, [`scenario:${runtime.scenarioKey}@${runtime.scenarioRevision}`]);
      observe('TRUTH_REFRESH', runtime.missingFacts.length === 0 ? 'COMPLETED' : 'ACTIVE',
        runtime.missingFacts.length === 0 ? 'REQUIRED_FACTS_FRESH' : 'REQUIRED_FACTS_PENDING',
        runtime.availableFacts.map((fact) => `fact:${fact}`));
      observe('AVAILABILITY_RECONCILIATION', 'ACTIVE', 'RUNTIME_READINESS_REEVALUATED', [`scenario:${runtime.scenarioKey}@${runtime.scenarioRevision}`]);
    }

    // Pre-Offer legacy plans remain valid, but we must not invent historical Offer evidence.
    observe('USER_SELECTION', 'SKIPPED', 'LEGACY_PLAN_WITHOUT_PERSISTED_OFFER', [`plan-version:${planVersionId}`]);
    observe('USER_PLAN', 'COMPLETED', plan.activeVersionId === planVersionId ? 'IMMUTABLE_PLAN_VERSION_ACTIVE' : 'IMMUTABLE_PLAN_VERSION_PERSISTED', [`plan-version:${planVersionId}`]);
    if (decisions[0]) observe('DECISION', 'COMPLETED', 'STRATEGY_DECISION_PERSISTED', [`strategy-decision:${decisions[0].id}`]);
    if (approvals.some((item) => item.status === 'pending')) observe('RISK_POLICY_APPROVAL', 'ACTIVE', 'APPROVAL_PENDING', approvals.map((item) => `approval:${item.id}`));
    else if (approvals.some((item) => item.status === 'rejected')) observe('RISK_POLICY_APPROVAL', 'BLOCKED', 'APPROVAL_REJECTED', approvals.map((item) => `approval:${item.id}`));
    else if (approvals.some((item) => item.status === 'approved')) observe('RISK_POLICY_APPROVAL', 'COMPLETED', 'APPROVAL_GRANTED', approvals.map((item) => `approval:${item.id}`));
    if (latestExecution) {
      const executionState = executionLifecycleState(latestExecution.status, latestExecution.resultCode);
      observe('EXECUTION', executionState, `EXECUTION_${latestExecution.status.toUpperCase()}`, [`execution:${latestExecution.id}`]);
      if (['COMPLETED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(executionState)) {
        observe('VERIFICATION', executionState, latestExecution.resultCode === 'OUTCOME_UNKNOWN' ? 'RESULT_REQUIRES_RECONCILIATION' : 'EXECUTION_TERMINAL_RESULT', [`execution:${latestExecution.id}`]);
        observe('TODAY_RECORDS', 'COMPLETED', 'EXECUTION_RECORD_AVAILABLE', [`execution:${latestExecution.id}`]);
      }
    }

    return buildPlanLifecycleProjection({
      planId,
      planVersionId,
      scenarioKey: scenario?.key ?? null,
      readiness: runtime?.product ?? null,
      observations,
      evaluatedAt: runtime?.evaluatedAt ?? new Date().toISOString(),
    });
  }
}

function executionLifecycleState(status: string, resultCode: string | null): PlanLifecycleObservation['state'] {
  if (resultCode === 'OUTCOME_UNKNOWN') return 'OUTCOME_UNKNOWN';
  if (status === 'succeeded') return 'COMPLETED';
  if (status === 'failed') return 'FAILED';
  if (status === 'cancelled') return 'SKIPPED';
  return 'ACTIVE';
}
