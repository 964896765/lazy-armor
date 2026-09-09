import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CONDITION_AST_SCHEMA_VERSION, OPERATOR_REGISTRY, OPERATOR_REGISTRY_REVISION, PLAN_EXECUTION_LIFECYCLE,
  canonicalStringify, compileScenarioPlan, definitionHash, evaluateConditionAst,
  type CompiledStrategyRuntime, type RuntimeFactInput, type StrategyKey,
} from '@lazy-armor/plan-schema';
import {
  plans, planVersions, strategyRuntimeBindings, strategyRuntimeDecisions, strategyRuntimeWakeups,
  truthFactDependencies, truthRecords, truthRecordVersions,
} from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type StrategyRuntimeExecutor = Pick<InjectedDatabase, 'select' | 'insert'>;
type BindingInput = { planVersionId: string; scenarioKey: string; strategy?: StrategyKey; subjectKey?: string };
type DependencyQuery = { factKey?: string; resourceType?: string; subjectKey?: string };
type TruthChangeInput = { truthRecordVersionId: string; factKey: string; resourceType: string; subjectKey: string };

@Injectable()
export class StrategyRuntimeService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  operators() {
    return { schemaVersion: CONDITION_AST_SCHEMA_VERSION, revision: OPERATOR_REGISTRY_REVISION, operators: OPERATOR_REGISTRY };
  }

  async bind(userId: string, input: BindingInput) {
    const owned = (await this.db.select({ version: planVersions, plan: plans }).from(planVersions)
      .innerJoin(plans, and(eq(plans.id, planVersions.planId), eq(plans.userId, userId)))
      .where(eq(planVersions.id, input.planVersionId)).limit(1))[0];
    if (!owned) throw new NotFoundException('Plan version not found');

    let compiled;
    try {
      compiled = compileScenarioPlan({
        scenarioKey: input.scenarioKey,
        strategy: input.strategy,
        subjectKey: input.subjectKey,
        name: owned.version.name,
        mode: 'DRAFT',
        readiness: { manualInputAvailable: true, observationPipelineAvailable: true, executionPipelineAvailable: true },
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Strategy runtime compilation failed');
    }
    if (definitionHash(compiled.definition) !== owned.version.definitionHash) {
      throw new ConflictException('Plan version does not match the compiled scenario definition');
    }

    const prior = await this.findBinding(userId, input.planVersionId);
    if (prior) {
      if (prior.runtimeHash !== compiled.runtime.runtimeHash) throw new ConflictException('Plan version already has a different immutable runtime binding');
      return this.bindingResponse(prior);
    }

    const bindingId = newId();
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(strategyRuntimeBindings).values({
          id: bindingId,
          userId,
          planVersionId: input.planVersionId,
          scenarioKey: compiled.scenarioKey,
          scenarioRevision: compiled.scenarioRevision,
          strategyKey: compiled.strategy,
          strategyRevision: compiled.runtime.strategyRevision,
          schemaVersion: compiled.runtime.schemaVersion,
          runtimeHash: compiled.runtime.runtimeHash,
          runtimeJson: compiled.runtime as unknown as Record<string, unknown>,
          createdAt: now,
        });
        for (const dependency of compiled.runtime.dependencies) {
          await tx.insert(truthFactDependencies).values({
            id: newId(),
            bindingId,
            userId,
            planVersionId: input.planVersionId,
            dependencyKey: hash({ planVersionId: input.planVersionId, ...dependency }),
            factKey: dependency.factKey,
            resourceType: dependency.resourceType,
            field: dependency.field,
            scope: dependency.scope,
            subjectKey: dependency.subjectKey,
            createdAt: now,
          });
        }
        await this.audit.append({
          actorType: 'user', actorUserId: userId, action: 'STRATEGY_RUNTIME_BOUND',
          resourceType: 'strategy_runtime_binding', resourceId: bindingId, userId,
          correlationId: owned.plan.id, causationId: input.planVersionId,
          after: { scenarioKey: compiled.scenarioKey, strategy: compiled.strategy, runtimeHash: compiled.runtime.runtimeHash },
          changeSummary: `Bound ${compiled.strategy} runtime to immutable plan version`,
          source: 'api', result: 'success',
        }, tx);
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
    const binding = await this.findBinding(userId, input.planVersionId);
    if (!binding) throw new ConflictException('Strategy runtime binding could not be materialized');
    if (binding.runtimeHash !== compiled.runtime.runtimeHash) throw new ConflictException('Plan version already has a different immutable runtime binding');
    return this.bindingResponse(binding);
  }

  async listDependencies(userId: string, query: DependencyQuery = {}) {
    const conditions = [eq(truthFactDependencies.userId, userId)];
    if (query.factKey) conditions.push(eq(truthFactDependencies.factKey, query.factKey));
    if (query.resourceType) conditions.push(eq(truthFactDependencies.resourceType, query.resourceType));
    if (query.subjectKey) conditions.push(eq(truthFactDependencies.subjectKey, query.subjectKey));
    const rows = await this.db.select({ dependency: truthFactDependencies, binding: strategyRuntimeBindings, planStatus: plans.status })
      .from(truthFactDependencies)
      .innerJoin(strategyRuntimeBindings, eq(strategyRuntimeBindings.id, truthFactDependencies.bindingId))
      .innerJoin(planVersions, eq(planVersions.id, truthFactDependencies.planVersionId))
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(...conditions)).orderBy(desc(truthFactDependencies.createdAt));
    return rows.map(({ dependency, binding, planStatus }) => ({ ...dependency, strategyKey: binding.strategyKey, scenarioKey: binding.scenarioKey, planStatus }));
  }

  async enqueueTruthChange(userId: string, input: TruthChangeInput, executor: StrategyRuntimeExecutor = this.db) {
    const rows = await executor.select({ dependency: truthFactDependencies, binding: strategyRuntimeBindings })
      .from(truthFactDependencies)
      .innerJoin(strategyRuntimeBindings, eq(strategyRuntimeBindings.id, truthFactDependencies.bindingId))
      .innerJoin(planVersions, eq(planVersions.id, truthFactDependencies.planVersionId))
      .innerJoin(plans, and(
        eq(plans.id, planVersions.planId),
        eq(plans.activeVersionId, truthFactDependencies.planVersionId),
        eq(plans.status, 'active'),
      ))
      .where(and(
        eq(truthFactDependencies.userId, userId),
        eq(truthFactDependencies.factKey, input.factKey),
        eq(truthFactDependencies.resourceType, input.resourceType),
        or(
          eq(truthFactDependencies.scope, 'RESOURCE_WIDE'),
          eq(truthFactDependencies.scope, 'USER_AGGREGATE'),
          and(eq(truthFactDependencies.scope, 'EXACT_SUBJECT'), eq(truthFactDependencies.subjectKey, input.subjectKey)),
        ),
      ));
    const created = [];
    for (const row of rows) {
      const runtime = row.binding.runtimeJson as unknown as CompiledStrategyRuntime;
      if (!runtime.triggerProfile.acceptedModes.includes('FACT_CHANGED')) continue;
      const wakeupKey = hash({ bindingId: row.binding.id, truthRecordVersionId: input.truthRecordVersionId });
      const id = newId();
      try {
        await executor.insert(strategyRuntimeWakeups).values({
          id,
          bindingId: row.binding.id,
          userId,
          planVersionId: row.dependency.planVersionId,
          truthRecordVersionId: input.truthRecordVersionId,
          wakeupKey,
          factKey: input.factKey,
          resourceType: input.resourceType,
          subjectKey: input.subjectKey,
          triggerMode: 'FACT_CHANGED',
          status: 'PENDING',
          createdAt: new Date(),
          evaluatedAt: null,
        });
        created.push(id);
        await this.audit.append({
          actorType: 'system', action: 'STRATEGY_RUNTIME_WAKEUP_ENQUEUED',
          resourceType: 'strategy_runtime_wakeup', resourceId: id, userId,
          correlationId: row.binding.id, causationId: input.truthRecordVersionId,
          changeSummary: `Truth change matched ${row.dependency.scope} dependency`,
          source: 'system', result: 'pending',
        }, executor);
      } catch (error) {
        if (!isDuplicate(error)) throw error;
      }
    }
    return created;
  }

  async listWakeups(userId: string) {
    return this.db.select({ wakeup: strategyRuntimeWakeups, binding: strategyRuntimeBindings })
      .from(strategyRuntimeWakeups)
      .innerJoin(strategyRuntimeBindings, eq(strategyRuntimeBindings.id, strategyRuntimeWakeups.bindingId))
      .where(eq(strategyRuntimeWakeups.userId, userId))
      .orderBy(desc(strategyRuntimeWakeups.createdAt));
  }

  async evaluateWakeup(userId: string, wakeupId: string, retryCount = 0): Promise<ReturnType<StrategyRuntimeService['decisionResponse']>> {
    const row = (await this.db.select({ wakeup: strategyRuntimeWakeups, binding: strategyRuntimeBindings })
      .from(strategyRuntimeWakeups)
      .innerJoin(strategyRuntimeBindings, eq(strategyRuntimeBindings.id, strategyRuntimeWakeups.bindingId))
      .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Strategy runtime wakeup not found');
    const persisted = await this.findDecision(userId, wakeupId);
    if (persisted) return this.decisionResponse(persisted);

    const truth = (await this.db.select({ version: truthRecordVersions, record: truthRecords })
      .from(truthRecordVersions)
      .innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, userId)))
      .where(eq(truthRecordVersions.id, row.wakeup.truthRecordVersionId)).limit(1))[0];
    if (!truth) throw new ConflictException('Wakeup TruthVersion is unavailable');
    const previous = (await this.db.select().from(truthRecordVersions)
      .where(and(
        eq(truthRecordVersions.truthRecordId, truth.version.truthRecordId),
        lt(truthRecordVersions.versionNumber, truth.version.versionNumber),
      ))
      .orderBy(desc(truthRecordVersions.versionNumber)).limit(1))[0];
    const runtime = row.binding.runtimeJson as unknown as CompiledStrategyRuntime;
    const { runtimeHash, ...hashableRuntime } = runtime;
    if (runtimeHash !== row.binding.runtimeHash || hash(hashableRuntime) !== runtimeHash) {
      throw new ConflictException('Strategy runtime binding integrity check failed');
    }
    const dependency = runtime.dependencies.find((item) => item.factKey === row.wakeup.factKey && item.scope !== 'SCHEDULED');
    const evaluatedAt = new Date();
    const fact: RuntimeFactInput = {
      value: runtimeValue(truth.version.valueJson, dependency?.field),
      ...(previous ? { previousValue: runtimeValue(previous.valueJson, dependency?.field) } : {}),
      truthVersionId: truth.version.id,
      verifiedAt: truth.record.verifiedAt.toISOString(),
    };
    const conditionDecision = evaluateConditionAst(runtime.conditionAst, {
      facts: { [row.wakeup.factKey]: fact },
      evaluatedAt: evaluatedAt.toISOString(),
    });
    const triggerDecision = {
      schemaVersion: '1', mode: row.wakeup.triggerMode, result: true,
      truthVersionId: truth.version.id, evaluatedAt: evaluatedAt.toISOString(), deterministic: true,
    };
    const lifecycleTrace = PLAN_EXECUTION_LIFECYCLE.map((step) => ({
      ...step,
      state: step.step <= 6 ? 'SUCCEEDED' : step.step === 7
        ? (conditionDecision.result ? 'SUCCEEDED' : 'SKIPPED')
        : (conditionDecision.result ? 'NOT_STARTED' : 'SKIPPED'),
      ...(step.step > 7 && conditionDecision.result ? { reason: 'HANDOFF_TO_EXISTING_PLAN_ENGINE' } : {}),
      ...(step.step >= 7 && !conditionDecision.result ? { reason: 'CONDITION_FALSE' } : {}),
    }));
    const inputHash = hash({ runtimeHash, triggerDecision, fact });
    const result = conditionDecision.result ? 'READY_FOR_PLAN_ENGINE' : 'CONDITION_NOT_MET';
    const decisionHash = hash({ inputHash, triggerDecision, conditionDecision, lifecycleTrace, result });
    const decisionId = newId();
    try {
      await this.db.transaction(async (tx) => {
        const locked = (await tx.select({ id: strategyRuntimeWakeups.id }).from(strategyRuntimeWakeups)
          .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId)))
          .for('update').limit(1))[0];
        if (!locked) throw new NotFoundException('Strategy runtime wakeup not found');
        const winner = (await tx.select({ id: strategyRuntimeDecisions.id }).from(strategyRuntimeDecisions)
          .where(and(eq(strategyRuntimeDecisions.userId, userId), eq(strategyRuntimeDecisions.wakeupId, wakeupId))).limit(1))[0];
        if (winner) return;
        await tx.insert(strategyRuntimeDecisions).values({
          id: decisionId,
          bindingId: row.binding.id,
          wakeupId,
          userId,
          inputHash,
          decisionHash,
          triggerDecisionJson: triggerDecision,
          conditionDecisionJson: conditionDecision as unknown as Record<string, unknown>,
          lifecycleTraceJson: lifecycleTrace,
          result,
          evaluatedAt,
        });
        await tx.update(strategyRuntimeWakeups)
          .set({ status: result, evaluatedAt })
          .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId)));
        await this.audit.append({
          actorType: 'system', action: 'STRATEGY_RUNTIME_EVALUATED',
          resourceType: 'strategy_runtime_decision', resourceId: decisionId, userId,
          correlationId: row.binding.id, causationId: wakeupId,
          after: { result, inputHash, decisionHash, truthVersionIds: conditionDecision.truthVersionIds },
          changeSummary: `Deterministic condition evaluation produced ${result}`,
          source: 'system', result: conditionDecision.result ? 'success' : 'blocked',
          reasonCode: conditionDecision.result ? null : 'CONDITION_FALSE',
        }, tx);
      });
    } catch (error) {
      if (!isDuplicate(error) && !isConcurrencyConflict(error)) throw error;
      if (isConcurrencyConflict(error) && retryCount < 2) {
        return this.evaluateWakeup(userId, wakeupId, retryCount + 1);
      }
    }
    const decision = await this.findDecision(userId, wakeupId);
    if (!decision) throw new ConflictException('Strategy runtime decision could not be persisted');
    return this.decisionResponse(decision);
  }

  private async findBinding(userId: string, planVersionId: string) {
    return (await this.db.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.userId, userId), eq(strategyRuntimeBindings.planVersionId, planVersionId))).limit(1))[0];
  }

  private async findDecision(userId: string, wakeupId: string) {
    return (await this.db.select().from(strategyRuntimeDecisions)
      .where(and(eq(strategyRuntimeDecisions.userId, userId), eq(strategyRuntimeDecisions.wakeupId, wakeupId))).limit(1))[0];
  }

  private async bindingResponse(binding: typeof strategyRuntimeBindings.$inferSelect) {
    const dependencies = await this.db.select().from(truthFactDependencies).where(eq(truthFactDependencies.bindingId, binding.id));
    return { ...binding, runtime: binding.runtimeJson, dependencies };
  }

  private decisionResponse(decision: typeof strategyRuntimeDecisions.$inferSelect) {
    return {
      id: decision.id,
      bindingId: decision.bindingId,
      wakeupId: decision.wakeupId,
      inputHash: decision.inputHash,
      decisionHash: decision.decisionHash,
      triggerDecision: decision.triggerDecisionJson,
      conditionDecision: decision.conditionDecisionJson,
      lifecycleTrace: decision.lifecycleTraceJson,
      result: decision.result,
      evaluatedAt: decision.evaluatedAt.toISOString(),
    };
  }
}

function hash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
function runtimeValue(value: Record<string, unknown>, field?: string): unknown {
  const payload = Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (field && Object.prototype.hasOwnProperty.call(record, field)) return record[field];
    if (Object.prototype.hasOwnProperty.call(record, 'value')) return record.value;
  }
  return payload;
}
function isDuplicate(error: unknown) { let current = error; for (let index = 0; index < 5 && current && typeof current === 'object'; index += 1) { const item = current as { code?: string; cause?: unknown }; if (item.code === 'ER_DUP_ENTRY') return true; current = item.cause; } return false; }
function isConcurrencyConflict(error: unknown) {
  let current = error;
  for (let index = 0; index < 5 && current && typeof current === 'object'; index += 1) {
    const item = current as { code?: string; cause?: unknown };
    if (item.code === 'ER_LOCK_DEADLOCK' || item.code === 'ER_LOCK_WAIT_TIMEOUT') return true;
    current = item.cause;
  }
  return false;
}
