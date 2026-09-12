import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { actionIntents, actionAdapterBindings, executionSteps, executions, planActions, plans } from '@lazy-armor/database';
import { ACTION_ADAPTER_REVISION, buildActionIntent, catalogHash, definitionHash, riskMaximum, type ContextRiskSignal, type RiskLevel } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../infrastructure/queue.service';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionStateService } from './execution-state.service';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { RiskEngine } from '../risk/risk-engine.service';
import { SafetyPolicyService } from '../risk/safety-policy.service';
import { RISK_SCORE } from '../risk/risk.types';
import { CapabilityResolverService } from '../capability-resolver/capability-resolver.service';

@Injectable()
export class ExecutionDispatchService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly assembler: PlanDefinitionAssembler,
    private readonly queue: QueueService,
    private readonly policy: ExecutionPolicyService,
    private readonly states: ExecutionStateService,
    private readonly events: ExecutionEventService,
    private readonly sanitizer: SnapshotSanitizer,
    private readonly riskEngine: RiskEngine,
    private readonly safetyPolicies: SafetyPolicyService,
    private readonly audit: AuditService,
    private readonly resolver: CapabilityResolverService,
  ) {}

  async dispatchManual(userId: string, planId: string, requestId: string, triggerPayload: Record<string, unknown>, resolutionDecisionIds?: string[]) {
    const resolvedDispatchInputHash = resolutionDecisionIds ? catalogHash({ planId, requestId, triggerPayload: this.sanitizer.sanitize(triggerPayload), resolutionDecisionIds: [...resolutionDecisionIds].sort() }) : null;
    const duplicate = await this.findDuplicate(userId, requestId);
    if (duplicate) return this.replayResolved(duplicate, resolvedDispatchInputHash);
    const resolutions = resolutionDecisionIds ? await Promise.all(resolutionDecisionIds.map((resolutionId) => this.resolver.revalidate(userId, resolutionId))) : [];
    if (new Set(resolutionDecisionIds).size !== (resolutionDecisionIds?.length ?? 0)) throw new ConflictException('Duplicate resolution decision');
    const id = newId();
    const now = new Date();
    const triggerSnapshot = this.sanitizer.sanitize(triggerPayload);
    let pinnedVersionId = '';
    try {
      await this.db.transaction(async (tx) => {
        const planRows = await tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1).for('update');
        const plan = planRows[0];
        if (!plan) throw new NotFoundException('Plan not found');
        if (plan.status !== 'active') throw new ConflictException('Only active plans can create Executions');
        if (!plan.activeVersionId) throw new ConflictException('Plan has no active version');
        pinnedVersionId = plan.activeVersionId;
        if (resolutions.some((resolution) => resolution.row.planVersionId !== pinnedVersionId || resolution.requirement.operation !== 'execute')) throw new ConflictException('Resolution must authorize an execute capability on the active PlanVersion');
        const assembled = await this.assembler.assembleById(userId, planId, pinnedVersionId, tx);
        if (assembled.computedHash !== assembled.version.definitionHash) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
        const actionRows = await tx.select().from(planActions).where(eq(planActions.planVersionId, pinnedVersionId)).orderBy(asc(planActions.stepOrder));
        if (actionRows.length !== assembled.definition.actions.length) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
        if (resolutions.some((resolution) => !actionRows.some((action) => resolution.candidate.id === action.connectionId + ':' + action.requiredCapability))) throw new ConflictException('Resolution is not used by this PlanVersion');
        const riskSnapshots = await Promise.all(assembled.definition.actions.map((action, index) => this.riskEngine.evaluate(action, actionRows[index]!.riskLevel as RiskLevel, triggerSnapshot, actionRows[index]!.connectorId, tx, pinnedVersionId,
          resolutions.find((item) => item.candidate.id === actionRows[index]!.connectionId + ':' + action.requiredCapability)?.candidate.capability.riskLevel ?? 'R0')));
        for (const [index, snapshot] of riskSnapshots.entries()) {
          const row = actionRows[index]!;
          const resolution = resolutions.find((item) => item.candidate.id === row.connectionId + ':' + row.requiredCapability);
          if (resolution && RISK_SCORE[snapshot.effectiveRisk] > RISK_SCORE[resolution.requirement.maxRisk]) throw new ConflictException('Action context exceeds the resolved maximum risk');
        }
        const risk = riskSnapshots.reduce<RiskLevel>((highest, snapshot) => RISK_SCORE[snapshot.effectiveRisk] > RISK_SCORE[highest] ? snapshot.effectiveRisk : highest, 'R0');
        const approvalPolicy = this.safetyPolicies.resolveFromDefinition(assembled.definition.approvalPolicy);
        await tx.insert(executions).values({
          id, userId, planId, planVersionId: pinnedVersionId, definitionHash: definitionHash(assembled.definition), requestId,
          retryOfExecutionId: null, triggerType: 'manual', triggerPayloadJson: triggerSnapshot, status: 'created',
          declaredRiskLevel: risk, approvalStatus: 'not_requested', executionPolicyVersion: this.policy.current.version,
          resolvedRetryPolicyJson: this.policy.retry as unknown as Record<string, unknown>, resolvedFallbackPolicyJson: this.policy.fallback as unknown as Record<string, unknown>,
          riskPolicyVersion: riskSnapshots[0]?.policyVersion ?? 'p0-6-risk-v1',
          resolvedRiskSnapshotJson: this.sanitizer.sanitize({ steps: riskSnapshots, actionIntentSchemaVersion: '1', ...(resolvedDispatchInputHash ? { resolvedDispatchInputHash } : {}) }) as Record<string, unknown>,
          resolvedApprovalPolicyJson: approvalPolicy as unknown as Record<string, unknown>,
          resultCode: null, resultSummary: null, errorCode: null, errorMessage: null, cancellationRequestedAt: null,
          queuedAt: null, startedAt: null, finishedAt: null, workerToken: null, heartbeatAt: null, leaseExpiresAt: null, createdAt: now, updatedAt: now,
        });
        for (const [index, action] of assembled.definition.actions.entries()) {
          const row = actionRows[index];
          const riskSnapshot = riskSnapshots[index];
          if (!row || !riskSnapshot || row.stepOrder !== action.stepOrder || row.actionType !== action.actionType) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
          const intentId = newId();
          const resolution = resolutions.find((item) => item.requirement.capabilityKey === row.requiredCapability && item.candidate.id === row.connectionId + ':' + row.requiredCapability);
          if (resolutionDecisionIds && row.requiredCapability && !resolution) throw new ConflictException('Resolved action must match its immutable Connection and Capability');
          if (resolution && typeof action.config.resource === 'string' && resolution.requirement.resource !== action.config.resource) throw new ConflictException('Resolution resource does not match action semantics');
          const intent = buildActionIntent({ intentId, planVersionId: pinnedVersionId, planActionId: row.id, actionType: action.actionType,
            capabilityKey: row.requiredCapability, resourceType: resolution?.requirement.resource ?? (typeof action.config.resource === 'string' ? action.config.resource : action.actionType),
            target: { connectorId: row.connectorId, connectionId: row.connectionId, capabilityResolutionDecisionId: resolution?.row.id ?? null, capabilityResolutionDecisionHash: resolution?.row.decisionHash ?? null },
            payload: { actionConfig: action.config, triggerPayload: triggerSnapshot }, desiredOutcome: 'Complete ' + action.actionType + ' and record its result',
            sideEffectKey: 'execution:' + id + ':action:' + row.id, providerRiskFloor: riskSnapshot.capabilityRisk ?? 'R0',
            scenarioRiskFloor: riskSnapshot.scenarioRisk ?? 'R0', actionRisk: riskMaximum(riskSnapshot.registryRisk, riskSnapshot.declaredRisk),
            contextSignals: riskSnapshot.factors.map((factor) => ({ code: factorCode(factor), floor: riskSnapshot.dynamicRisk })) });
          if (intent.effectiveRisk !== riskSnapshot.effectiveRisk) throw new ConflictException('ACTION_INTENT_RISK_MISMATCH');
          await tx.insert(actionIntents).values({ id: intentId, userId, planId, planVersionId: pinnedVersionId, planActionId: row.id, executionId: id,
            schemaVersion: intent.schemaVersion, actionType: intent.actionType, capabilityKey: intent.capabilityKey, resourceType: intent.resourceType,
            targetJson: intent.target, payloadJson: intent.payload, payloadHash: intent.payloadHash, desiredOutcome: intent.desiredOutcome,
            sideEffectKey: intent.sideEffectKey, providerRiskFloor: intent.providerRiskFloor, scenarioRiskFloor: intent.scenarioRiskFloor,
            actionRisk: intent.actionRisk, contextRiskElevation: intent.contextRiskElevation, effectiveRiskLevel: intent.effectiveRisk,
            contextSignalsJson: intent.contextSignals as unknown as Record<string, unknown>[], intentHash: intent.intentHash, status: 'BOUND_TO_EXECUTION', createdAt: now });
          const adapter = { actionIntentId: intentId, adapterRevision: ACTION_ADAPTER_REVISION,
            adapterKey: 'existing-runner:' + action.actionType, connectorId: row.connectorId, connectionId: row.connectionId, capabilityKey: row.requiredCapability,
            capabilityResolutionDecisionId: resolution?.row.id ?? null, capabilityResolutionDecisionHash: resolution?.row.decisionHash ?? null };
          await tx.insert(actionAdapterBindings).values({ id: newId(), ...adapter, bindingHash: catalogHash(adapter), status: 'BOUND', createdAt: now });
          await tx.insert(executionSteps).values({
            id: newId(), executionId: id, planActionId: row.id, actionIntentId: intentId, stepOrder: row.stepOrder, actionType: row.actionType,
            connectorId: row.connectorId, connectionId: row.connectionId, requiredCapability: row.requiredCapability,
            declaredRiskLevel: row.riskLevel, effectiveRiskLevel: riskSnapshot.effectiveRisk,
            riskSnapshotJson: this.sanitizer.sanitize(riskSnapshot) as Record<string, unknown>, inputFingerprint: riskSnapshot.inputFingerprint,
            approvalGateStatus: RISK_SCORE[riskSnapshot.effectiveRisk] >= RISK_SCORE.R2 ? 'not_requested' : 'not_required',
            status: 'pending', attemptCount: 0, retryCount: 0,
            inputSnapshotJson: this.sanitizer.sanitize({ triggerPayload: triggerSnapshot, actionConfig: action.config }), outputSnapshotJson: null,
            nextRetryAt: null, startedAt: null, finishedAt: null, errorCode: null, errorMessage: null, fallbackResultJson: null,
            createdAt: now, updatedAt: now,
          });
        }
        await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'EXECUTION_CREATED', resourceType: 'execution', resourceId: id, userId, executionId: id, requestId, correlationId: requestId, changeSummary: `Execution created for plan ${planId}`, source: 'api', result: 'success' }, tx);
      });
    } catch (error) {
      const raced = await this.findDuplicate(userId, requestId);
      if (raced) return this.replayResolved(raced, resolvedDispatchInputHash);
      throw error;
    }
    await this.events.append(id, 'execution_created', { triggerType: 'manual', planVersionId: pinnedVersionId });
    try {
      await this.enqueue(id);
    } catch (error) {
      await this.events.append(id, 'queue_enqueue_failed', { message: this.sanitizer.sanitizeText(error) });
    }
    return this.getRow(userId, id);
  }

  async enqueue(executionId: string) {
    await this.queue.addExecution(executionId, this.policy.current);
    const rows = await this.db.select({ status: executions.status }).from(executions).where(eq(executions.id, executionId)).limit(1);
    if (rows[0]?.status === 'created' || rows[0]?.status === 'retry_wait') {
      await this.states.transition(executionId, 'queued', { queuedAt: new Date() });
    }
    await this.events.append(executionId, 'execution_queued', { jobId: executionId });
  }

  private async findDuplicate(userId: string, requestId: string) {
    const rows = await this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.requestId, requestId))).limit(1);
    return rows[0] ?? null;
  }

  private replayResolved(row: typeof executions.$inferSelect, inputHash: string | null) {
    if (inputHash && row.resolvedRiskSnapshotJson?.resolvedDispatchInputHash !== inputHash) throw new ConflictException('Resolved execution request key reused with different input');
    return row;
  }

  private async getRow(userId: string, id: string) {
    const rows = await this.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Execution not found');
    return rows[0];
  }
}

function factorCode(factor: string): ContextRiskSignal['code'] {
  const codes: Record<string, ContextRiskSignal['code']> = { sensitive_or_account_permission: 'ACCOUNT_PERMISSION_CHANGE', public_visibility: 'PUBLIC_VISIBILITY',
    irreversible: 'IRREVERSIBLE', large_batch: 'LARGE_BATCH', high_amount: 'HIGH_AMOUNT', monetary_action: 'MONETARY_ACTION' };
  return codes[factor] ?? 'SENSITIVE_DATA';
}
