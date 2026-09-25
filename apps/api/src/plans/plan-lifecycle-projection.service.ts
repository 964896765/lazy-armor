import { Inject, Injectable } from '@nestjs/common';
import {
  approvalRequests,
  executions,
  planCreationContracts,
  plans,
  planVersions,
  strategyRuntimeBindings,
  strategyRuntimeDecisions,
} from '@lazy-armor/database';
import {
  assessPlanAvailability,
  buildPlanLifecycleProjection,
  persistentPlanOfferRequestSchema,
  scenarioByKey,
  type FactDemandProjection,
  type PlanLifecycleObservation,
} from '@lazy-armor/plan-schema';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { LifecycleReadService } from './lifecycle-read.service';

/**
 * Outer 17-step consumer projection. This service only reads the existing
 * Plan/Truth/Decision/Execution authorities and never mutates their state.
 */
@Injectable()
export class PlanLifecycleProjectionService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly readiness: ReadinessEvidenceService,
    private readonly factDemands: FactDemandResolverService,
    private readonly lifecycleRead: LifecycleReadService,
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

    const [version, binding, latestExecution, creationContract] = await Promise.all([
      this.db.select({ id: planVersions.id, domain: planVersions.domain, name: planVersions.name })
        .from(planVersions).where(and(eq(planVersions.id, planVersionId), eq(planVersions.planId, planId))).limit(1).then((rows) => rows[0]),
      this.db.select({ id: strategyRuntimeBindings.id, scenarioKey: strategyRuntimeBindings.scenarioKey })
        .from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.planVersionId, planVersionId), eq(strategyRuntimeBindings.userId, userId))).limit(1).then((rows) => rows[0]),
      this.db.select({ id: executions.id, status: executions.status, resultCode: executions.resultCode })
        .from(executions).where(and(eq(executions.planId, planId), eq(executions.userId, userId)))
        .orderBy(desc(executions.createdAt), desc(executions.id)).limit(1).then((rows) => rows[0]),
      this.db.select({ id: planCreationContracts.id, scenarioKey: planCreationContracts.scenarioKey,
        scenarioRevision: planCreationContracts.scenarioRevision, contractHash: planCreationContracts.contractHash,
        goal: planCreationContracts.goalJson,
        subject: planCreationContracts.subjectJson, factDemands: planCreationContracts.factDemandsJson,
        sourceSelection: planCreationContracts.sourceSelectionJson, offer: planCreationContracts.offerJson })
        .from(planCreationContracts).where(and(eq(planCreationContracts.userId, userId),
          eq(planCreationContracts.planVersionId, planVersionId))).limit(1).then((rows) => rows[0]),
    ]);
    const scenario = binding ? scenarioByKey(binding.scenarioKey) : null;
    const runtime = scenario ? await this.readiness.projectScenarioRuntimeEvidence(userId, scenario) : null;
    const [decisions, approvals, exactDemands, executionLifecycle] = await Promise.all([
      binding ? this.db.select({ id: strategyRuntimeDecisions.id, result: strategyRuntimeDecisions.result })
        .from(strategyRuntimeDecisions).where(and(eq(strategyRuntimeDecisions.bindingId, binding.id), eq(strategyRuntimeDecisions.userId, userId)))
        .orderBy(desc(strategyRuntimeDecisions.evaluatedAt)).limit(1) : Promise.resolve([]),
      latestExecution ? this.db.select({ id: approvalRequests.id, status: approvalRequests.status })
        .from(approvalRequests).where(and(eq(approvalRequests.executionId, latestExecution.id), eq(approvalRequests.userId, userId))) : Promise.resolve([]),
      creationContract ? this.factDemands.resolve(userId, persistentPlanOfferRequestSchema.parse({
        scenarioKey: creationContract.scenarioKey,
        scenarioRevision: creationContract.scenarioRevision,
        goal: creationContract.goal,
        subject: creationContract.subject,
      })) : Promise.resolve(null),
      latestExecution ? this.lifecycleRead.forExecution(userId, latestExecution.id) : Promise.resolve(null),
    ]);

    const observations: PlanLifecycleObservation[] = [];
    const observe = (key: PlanLifecycleObservation['key'], state: PlanLifecycleObservation['state'], reasonCode: string, evidenceRefs: string[] = []) => {
      observations.push({ key, state, reasonCode, evidenceRefs });
    };
    if (version) observe('DOMAIN', 'COMPLETED', 'PLAN_VERSION_DOMAIN_PERSISTED', [`plan-version:${version.id}`]);
    if (scenario && binding) {
      observe('SCENARIO', 'COMPLETED', 'SCENARIO_RUNTIME_BINDING_PERSISTED', [`strategy-binding:${binding.id}`]);
      observe('REQUIREMENTS', 'COMPLETED', 'VERSIONED_SCENARIO_CONTRACT_LOADED', [`scenario:${scenario.key}@${scenario.revision}`]);
      observe('CAPABILITY_DISCOVERY', 'COMPLETED', exactDemands ? 'PLAN_SUBJECT_SOURCES_EVALUATED' : 'USER_RUNTIME_EVIDENCE_EVALUATED',
        exactDemands ? exactDemands.demands.flatMap((demand) => demand.candidateSources.flatMap((source) => source.evidenceRefs))
          : [`scenario:${scenario.key}@${scenario.revision}`]);
    } else observe('SCENARIO', 'BLOCKED', 'SCENARIO_RUNTIME_BINDING_MISSING');

    if (creationContract) {
      observe('GOAL_OBJECT', 'COMPLETED', 'GOAL_SPEC_AND_RESOURCE_SUBJECT_PERSISTED', [`plan-contract:${creationContract.id}`]);
      observe('PLAN_OFFERS', 'COMPLETED', 'PLAN_OFFER_SNAPSHOT_PERSISTED', [`plan-contract:${creationContract.id}`]);
      observe('RANK_EXPLAIN', 'COMPLETED', 'DETERMINISTIC_OFFER_EXPLANATION_PERSISTED', [`plan-contract:${creationContract.id}`]);
      observe('USER_SELECTION', 'COMPLETED', 'USER_OFFER_CONFIRMATION_PERSISTED', [`plan-contract:${creationContract.id}`]);
    } else {
      // Historical plans stay valid; missing new records are never backfilled with invented evidence.
      observe('GOAL_OBJECT', 'BLOCKED', 'GOAL_SPEC_OR_RESOURCE_SUBJECT_NOT_VERSIONED', [`plan-version:${planVersionId}`]);
      observe('USER_SELECTION', 'SKIPPED', 'LEGACY_PLAN_WITHOUT_PERSISTED_OFFER', [`plan-version:${planVersionId}`]);
    }
    if (exactDemands && creationContract) {
      const required = exactDemands.demands.filter((demand) => demand.required);
      const readinessState = demandReadinessState(required);
      observe('READINESS', readinessState, demandReadinessReason(required), demandEvidenceRefs(required));
      observe('TRUTH_REFRESH', truthRefreshState(required), truthRefreshReason(required),
        required.flatMap((demand) => demand.truthEvidence.map((truth) => `truth-version:${truth.truthVersionId}`)));
      const availability = assessPlanAvailability({
        expectedContractHash: creationContract.contractHash,
        currentContractHash: exactDemands.contractHash,
        previousSelections: creationContract.sourceSelection as Array<{ demandId: string; selectedSourceId: string | null }>,
        currentDemands: exactDemands.demands,
        evaluatedAt: exactDemands.evaluatedAt,
      });
      observe('AVAILABILITY_RECONCILIATION', availability.state === 'CURRENT' ? 'COMPLETED'
        : availability.state === 'REFRESH_REQUIRED' ? 'ACTIVE' : 'BLOCKED', availability.reasonCodes[0]!,
      [`plan-contract:${creationContract.id}`, ...demandEvidenceRefs(required)]);
    } else if (runtime) {
      const readinessState = runtime.product.userReadiness === 'READY' ? 'COMPLETED'
        : runtime.product.userReadiness === 'NEEDS_CONFIRMATION' ? 'READY' : 'BLOCKED';
      observe('READINESS', readinessState, runtime.product.userReadiness, [`scenario:${runtime.scenarioKey}@${runtime.scenarioRevision}`]);
      observe('TRUTH_REFRESH', runtime.missingFacts.length === 0 ? 'COMPLETED' : 'ACTIVE',
        runtime.missingFacts.length === 0 ? 'REQUIRED_FACTS_FRESH' : 'REQUIRED_FACTS_PENDING',
        runtime.availableFacts.map((fact) => `fact:${fact}`));
      observe('AVAILABILITY_RECONCILIATION', 'ACTIVE', 'RUNTIME_READINESS_REEVALUATED', [`scenario:${runtime.scenarioKey}@${runtime.scenarioRevision}`]);
    }

    observe('USER_PLAN', 'COMPLETED', plan.activeVersionId === planVersionId ? 'IMMUTABLE_PLAN_VERSION_ACTIVE' : 'IMMUTABLE_PLAN_VERSION_PERSISTED', [`plan-version:${planVersionId}`]);
    if (decisions[0]) observe('DECISION', 'COMPLETED', 'STRATEGY_DECISION_PERSISTED', [`strategy-decision:${decisions[0].id}`]);
    if (approvals.some((item) => item.status === 'pending')) observe('RISK_POLICY_APPROVAL', 'ACTIVE', 'APPROVAL_PENDING', approvals.map((item) => `approval:${item.id}`));
    else if (approvals.some((item) => item.status === 'rejected')) observe('RISK_POLICY_APPROVAL', 'BLOCKED', 'APPROVAL_REJECTED', approvals.map((item) => `approval:${item.id}`));
    else if (approvals.some((item) => item.status === 'approved')) observe('RISK_POLICY_APPROVAL', 'COMPLETED', 'APPROVAL_GRANTED', approvals.map((item) => `approval:${item.id}`));
    if (latestExecution && executionLifecycle) {
      const inner = new Map(executionLifecycle.lifecycle.steps.map((step) => [step.key, step]));
      const action = inner.get('EXECUTION');
      const verification = inner.get('VERIFICATION');
      const result = inner.get('RESULT');
      if (action && action.state !== 'NOT_REACHED') observe('EXECUTION', mapInnerState(action.state), action.reason ?? 'EXECUTION_EVIDENCE', [`execution:${latestExecution.id}`]);
      if (verification && verification.state !== 'NOT_REACHED') observe('VERIFICATION', mapInnerState(verification.state), verification.reason ?? 'VERIFICATION_EVIDENCE', [`execution:${latestExecution.id}`]);
      if (result && result.state !== 'NOT_REACHED') observe('TODAY_RECORDS', mapInnerState(result.state), result.reason ?? 'EXECUTION_RESULT', [`execution:${latestExecution.id}`]);
    }

    return buildPlanLifecycleProjection({
      planId,
      planVersionId,
      scenarioKey: scenario?.key ?? null,
      readiness: runtime?.product ?? null,
      observations,
      evaluatedAt: exactDemands?.evaluatedAt ?? runtime?.evaluatedAt ?? new Date().toISOString(),
    });
  }
}

function hardDemandBlock(demand: FactDemandProjection) {
  return ['CONFLICT', 'NEEDS_PERMISSION', 'DEVICE_OFFLINE', 'PROVIDER_UNHEALTHY', 'SOURCE_NOT_IMPLEMENTED', 'NEEDS_SOURCE'].includes(demand.state);
}
function demandReadinessState(demands: readonly FactDemandProjection[]): PlanLifecycleObservation['state'] {
  if (demands.some(hardDemandBlock)) return 'BLOCKED';
  return demands.every((demand) => demand.state === 'SATISFIED') ? 'COMPLETED' : 'READY';
}
function demandReadinessReason(demands: readonly FactDemandProjection[]) {
  const blocked = demands.find(hardDemandBlock);
  if (blocked) return blocked.reasonCodes[0] ?? `FACT_DEMAND_${blocked.state}`;
  return demands.every((demand) => demand.state === 'SATISFIED') ? 'PLAN_SUBJECT_FACTS_READY' : 'PLAN_SUBJECT_SOURCES_READY';
}
function truthRefreshState(demands: readonly FactDemandProjection[]): PlanLifecycleObservation['state'] {
  if (demands.some(hardDemandBlock)) return 'BLOCKED';
  return demands.every((demand) => demand.state === 'SATISFIED') ? 'COMPLETED' : 'ACTIVE';
}
function truthRefreshReason(demands: readonly FactDemandProjection[]) {
  const pending = demands.find((demand) => demand.state !== 'SATISFIED');
  return pending?.reasonCodes[0] ?? 'PLAN_SUBJECT_FACTS_FRESH';
}
function demandEvidenceRefs(demands: readonly FactDemandProjection[]) {
  return [...new Set(demands.flatMap((demand) => demand.candidateSources.flatMap((source) => source.evidenceRefs)))].slice(0, 50);
}
function mapInnerState(state: string): PlanLifecycleObservation['state'] {
  if (state === 'SUCCEEDED') return 'COMPLETED';
  if (state === 'RUNNING' || state === 'UNKNOWN') return 'ACTIVE';
  if (state === 'BLOCKED' || state === 'FAILED' || state === 'OUTCOME_UNKNOWN' || state === 'SKIPPED') return state;
  return 'READY';
}
