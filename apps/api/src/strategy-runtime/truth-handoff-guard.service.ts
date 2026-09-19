import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  plans, planVersions, strategyRuntimeBindings, strategyRuntimeDecisions, strategyRuntimeWakeups,
  truthFactDependencies, truthRecords, truthRecordVersions,
} from '@lazy-armor/database';
import { catalogHash, realityValueHash, type CompiledStrategyRuntime } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export type HandoffTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/**
 * Common truth-boundary proof. It never stores the fact value; the execution
 * context is hydrated server-side from truthVersionId, never from this proof.
 */
export interface TruthHandoffProof {
  schema: 'truth-handoff.v1';
  wakeupId: string;
  bindingId: string;
  decisionId: string;
  decisionHash: string;
  planVersionId: string;
  definitionHash: string;
  runtimeHash: string;
  truthRecordId: string;
  truthVersionId: string;
  truthValueHash: string;
  factKey: string;
  resourceType: string;
  subjectKey: string;
  observedAt: string;
  evidenceHash: string;
}

const TRUTH_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Authorization-only common truth boundary. Terminal handoff composes this with
 * the OAuth / Connection / Grant / Credential / Health chain; mobile/internal
 * handoff uses it directly without fabricating an OAuth provider.
 */
@Injectable()
export class TruthHandoffGuard {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async lockTruth(userId: string, planId: string, wakeupId: string, tx: HandoffTransaction, expected?: TruthHandoffProof) {
    let boundary = 'PLAN';
    const reject = (): never => { throw new ForbiddenException({ code: 'TRUTH_HANDOFF_NOT_AUTHORIZED', message: `Truth handoff denied: ${boundary}` }); };
    const plan = (await tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1).for('update'))[0];
    if (!plan || plan.status !== 'active' || !plan.activeVersionId) return reject();
    boundary = 'WAKEUP_BINDING';
    const wakeup = (await tx.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId), eq(strategyRuntimeWakeups.planVersionId, plan.activeVersionId))).limit(1).for('update'))[0];
    const binding = wakeup && (await tx.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.id, wakeup.bindingId), eq(strategyRuntimeBindings.userId, userId), eq(strategyRuntimeBindings.planVersionId, plan.activeVersionId))).limit(1))[0];
    if (!wakeup || !binding || (wakeup.triggerMode !== 'FACT_CHANGED' && wakeup.triggerMode !== 'SCHEDULE')) return reject();
    boundary = 'PLAN_VERSION_INTEGRITY';
    const version = (await tx.select().from(planVersions).where(eq(planVersions.id, plan.activeVersionId)).limit(1))[0];
    const runtime = binding.runtimeJson as unknown as CompiledStrategyRuntime;
    if (!version || binding.runtimeHash !== runtime.runtimeHash) return reject();
    boundary = 'DEPENDENCY_DECISION_INTEGRITY';
    const dependency = runtime.dependencies.find((item) => item.factKey === wakeup.factKey && item.resourceType === wakeup.resourceType);
    const index = dependency && (await tx.select().from(truthFactDependencies).where(and(
      eq(truthFactDependencies.bindingId, binding.id),
      eq(truthFactDependencies.userId, userId),
      eq(truthFactDependencies.planVersionId, version.id),
      eq(truthFactDependencies.factKey, wakeup.factKey),
      eq(truthFactDependencies.resourceType, wakeup.resourceType),
      eq(truthFactDependencies.scope, dependency.scope),
      ...(dependency.scope === 'EXACT_SUBJECT' ? [eq(truthFactDependencies.subjectKey, wakeup.subjectKey)] : []),
    )).limit(1))[0];
    const decision = (await tx.select().from(strategyRuntimeDecisions).where(and(eq(strategyRuntimeDecisions.wakeupId, wakeupId), eq(strategyRuntimeDecisions.bindingId, binding.id), eq(strategyRuntimeDecisions.userId, userId))).limit(1))[0];
    if (!index || !decision || decision.result !== 'READY_FOR_PLAN_ENGINE' || decision.conditionDecisionJson.result !== true) return reject();
    boundary = 'CURRENT_TRUTH';
    const truth = (await tx.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecordVersions)
      .innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, userId)))
      .where(eq(truthRecordVersions.id, wakeup.truthRecordVersionId)).limit(1).for('update'))[0];
    if (!truth || truth.record.status !== 'verified' || truth.record.revokedAt || truth.record.currentVersionId !== truth.version.id || truth.record.subjectKey !== wakeup.subjectKey || truth.version.valueHash !== realityValueHash(truth.version.valueJson)) return reject();
    const valueJson = truth.version.valueJson as Record<string, unknown>;
    const proof: TruthHandoffProof = {
      schema: 'truth-handoff.v1', wakeupId, bindingId: binding.id, decisionId: decision.id, decisionHash: decision.decisionHash,
      planVersionId: version.id, definitionHash: version.definitionHash, runtimeHash: runtime.runtimeHash,
      truthRecordId: truth.record.id, truthVersionId: truth.version.id, truthValueHash: truth.version.valueHash,
      factKey: wakeup.factKey, resourceType: wakeup.resourceType, subjectKey: wakeup.subjectKey,
      observedAt: typeof valueJson.observedAt === 'string' ? valueJson.observedAt : truth.record.verifiedAt.toISOString(),
      evidenceHash: truth.version.evidenceHash,
    };
    if (expected && catalogHash(expected) !== catalogHash(proof)) return reject();
    const assertCurrent = () => {
      boundary = 'FRESHNESS_DEADLINE'; const now = new Date();
      if (truth.record.verifiedAt > now || now.getTime() - truth.record.verifiedAt.getTime() > TRUTH_HANDOFF_MAX_AGE_MS) reject();
    };
    assertCurrent();
    return { proof, assertCurrent, truthVersionId: truth.version.id, factKey: wakeup.factKey, resourceType: wakeup.resourceType, subjectKey: wakeup.subjectKey };
  }

  /** Execution pre-start revalidation: re-reads the Truth server-side and returns its value. */
  async revalidateTruth(userId: string, proof: TruthHandoffProof): Promise<Record<string, unknown>> {
    const truth = (await this.db.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecordVersions)
      .innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, userId)))
      .where(eq(truthRecordVersions.id, proof.truthVersionId)).limit(1))[0];
    if (!truth || truth.record.status !== 'verified' || truth.record.revokedAt || truth.record.currentVersionId !== truth.version.id
      || truth.record.subjectKey !== proof.subjectKey || truth.version.valueHash !== proof.truthValueHash) {
      throw new ForbiddenException({ code: 'TRUTH_HANDOFF_NOT_AUTHORIZED', message: 'Truth handoff revalidation failed' });
    }
    const now = new Date();
    if (truth.record.verifiedAt > now || now.getTime() - truth.record.verifiedAt.getTime() > TRUTH_HANDOFF_MAX_AGE_MS) {
      throw new ForbiddenException({ code: 'TRUTH_HANDOFF_NOT_AUTHORIZED', message: 'Truth handoff freshness failed' });
    }
    return truth.version.valueJson as Record<string, unknown>;
  }
}

/** Extracts the semantic fact value from a Truth version value (compatibility or canonical shape). */
export function extractFactValue(valueJson: Record<string, unknown>): Record<string, unknown> {
  const inner = valueJson && typeof valueJson === 'object' && !Array.isArray(valueJson) ? valueJson : {};
  if (inner.value && typeof inner.value === 'object' && !Array.isArray(inner.value)) return inner.value as Record<string, unknown>;
  const { resource, resourceType, resourceKey, subjectKey, factKey, observedAt, occurredAt, confidence, realityLevel, ...factValue } = inner;
  return factValue as Record<string, unknown>;
}
