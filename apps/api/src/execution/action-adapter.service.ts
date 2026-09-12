import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { actionAdapterBindings, actionIntents, connectors, executionSteps, executions, planActions, approvalRequests } from '@lazy-armor/database';
import { ACTION_ADAPTER_REVISION, buildActionIntent, catalogHash, type ContextRiskSignal, type NormalizedAction, type RiskLevel } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionRuntimeError } from './execution.types';
import { CapabilityResolverService } from '../capability-resolver/capability-resolver.service';
import { RiskEngine } from '../risk/risk-engine.service';
import type { RiskSnapshot } from '../risk/risk.types';
import { ExecutionApprovalGate } from './execution-approval-gate.service';

@Injectable()
export class ActionAdapter {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly resolver: CapabilityResolverService,
    private readonly risk: RiskEngine, private readonly approvalGate: ExecutionApprovalGate) {}

  async assertOperation(executionId: string, stepId: string) {
    const execution = (await this.db.select().from(executions).where(eq(executions.id, executionId)).limit(1))[0];
    const step = (await this.db.select().from(executionSteps).where(and(eq(executionSteps.id, stepId), eq(executionSteps.executionId, executionId))).limit(1))[0];
    const row = step && execution && (await this.db.select().from(planActions).where(and(eq(planActions.id, step.planActionId), eq(planActions.planVersionId, execution.planVersionId))).limit(1))[0];
    if (!execution || !step || !row) throw new ExecutionRuntimeError('ACTION_ADAPTER_INTEGRITY_ERROR', 'Execution action is unavailable');
    const connector = row.connectorId ? (await this.db.select({ key: connectors.key }).from(connectors).where(eq(connectors.id, row.connectorId)).limit(1))[0] : null;
    const action = { actionType: row.actionType, connectorKey: connector?.key ?? null, connectionId: row.connectionId,
      requiredCapability: row.requiredCapability, riskLevel: row.riskLevel, config: row.configJson, stepOrder: row.stepOrder } as NormalizedAction;
    await this.assertCompatible(execution, step, action);
    if (!step.actionIntentId) return;
    const snapshot = step.riskSnapshotJson as unknown as RiskSnapshot;
    if (!snapshot) throw new ExecutionRuntimeError('RISK_SNAPSHOT_MISSING', 'Risk context is unavailable');
    const current = await this.risk.evaluate(action, step.declaredRiskLevel as RiskLevel, execution.triggerPayloadJson, step.connectorId, this.db, execution.planVersionId, snapshot.manifestRiskFloor ?? 'R0');
    if (current.effectiveRisk !== step.effectiveRiskLevel || current.inputFingerprint !== step.inputFingerprint) throw new ExecutionRuntimeError('RISK_CONTEXT_CHANGED', 'Risk context changed before external dispatch');
    const approval = (await this.db.select().from(approvalRequests).where(eq(approvalRequests.executionStepId, stepId)).limit(1))[0];
    if ((current.minimumApprovalRequirement !== 'none' || approval) && approval?.status !== 'approved') {
      throw new ExecutionRuntimeError('APPROVAL_NOT_VALID', 'Required immutable approval is unavailable before external dispatch');
    }
    if (approval?.status === 'approved') await this.approvalGate.assertSnapshotValid(approval, execution, step, current);
  }

  async assertCompatible(execution: Pick<typeof executions.$inferSelect, 'id' | 'userId' | 'planVersionId' | 'triggerPayloadJson' | 'resolvedRiskSnapshotJson'>, step: typeof executionSteps.$inferSelect, action: NormalizedAction) {
    if (!step.actionIntentId) {
      // Historical executions keep their original risk/approval/side-effect guards.
      if (execution.resolvedRiskSnapshotJson?.actionIntentSchemaVersion === '1') throw new ExecutionRuntimeError('ACTION_INTENT_MISSING', 'New execution has no immutable ActionIntent');
      return;
    }
    const row = await this.get(execution.userId, step.actionIntentId);
    const binding = row.adapter;
    const intent = buildActionIntent({ intentId: row.id, planVersionId: row.planVersionId, planActionId: row.planActionId,
      actionType: row.actionType, capabilityKey: row.capabilityKey, resourceType: row.resourceType, target: row.targetJson,
      payload: row.payloadJson, desiredOutcome: row.desiredOutcome, sideEffectKey: row.sideEffectKey,
      providerRiskFloor: row.providerRiskFloor as RiskLevel, scenarioRiskFloor: row.scenarioRiskFloor as RiskLevel,
      actionRisk: row.actionRisk as RiskLevel, contextSignals: row.contextSignalsJson as unknown as ContextRiskSignal[] });
    const adapterIdentity = binding && { actionIntentId: row.id, adapterRevision: binding.adapterRevision,
      adapterKey: binding.adapterKey, connectorId: binding.connectorId, connectionId: binding.connectionId, capabilityKey: binding.capabilityKey,
      capabilityResolutionDecisionId: binding.capabilityResolutionDecisionId, capabilityResolutionDecisionHash: binding.capabilityResolutionDecisionHash };
    if (row.executionId !== execution.id || row.planVersionId !== execution.planVersionId || row.planActionId !== step.planActionId
      || row.actionType !== action.actionType || row.capabilityKey !== action.requiredCapability || row.status !== 'BOUND_TO_EXECUTION'
      || row.intentHash !== intent.intentHash || row.payloadHash !== intent.payloadHash || row.effectiveRiskLevel !== intent.effectiveRisk
      || row.effectiveRiskLevel !== step.effectiveRiskLevel
      || catalogHash(row.payloadJson) !== catalogHash({ actionConfig: action.config, triggerPayload: execution.triggerPayloadJson })
      || !binding || binding.status !== 'BOUND' || binding.adapterRevision !== ACTION_ADAPTER_REVISION
      || binding.adapterKey !== 'existing-runner:' + action.actionType || binding.connectorId !== step.connectorId
      || binding.connectionId !== step.connectionId || binding.capabilityKey !== step.requiredCapability
      || binding.bindingHash !== catalogHash(adapterIdentity)) {
      throw new ExecutionRuntimeError('ACTION_ADAPTER_INTEGRITY_ERROR', 'ActionIntent or adapter binding changed; execution denied');
    }
    if (binding.capabilityResolutionDecisionId) {
      const resolution = await this.resolver.revalidate(execution.userId, binding.capabilityResolutionDecisionId);
      if (resolution.row.decisionHash !== binding.capabilityResolutionDecisionHash || resolution.row.planVersionId !== execution.planVersionId
        || resolution.candidate.id !== step.connectionId + ':' + step.requiredCapability || resolution.requirement.operation !== 'execute'
        || Number(row.effectiveRiskLevel.slice(1)) > Number(resolution.requirement.maxRisk.slice(1))) {
        throw new ExecutionRuntimeError('ACTION_RESOLUTION_CHANGED', 'Selected capability changed; execution denied');
      }
    }
  }

  async get(userId: string, id: string) {
    const row = (await this.db.select().from(actionIntents).where(and(eq(actionIntents.id, id), eq(actionIntents.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('ActionIntent not found');
    const adapter = (await this.db.select().from(actionAdapterBindings).where(eq(actionAdapterBindings.actionIntentId, id)).limit(1))[0];
    return { ...row, adapter: adapter ?? null };
  }

  async listForExecution(userId: string, executionId: string) {
    const execution = (await this.db.select({ id: executions.id }).from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, userId))).limit(1))[0];
    if (!execution) throw new NotFoundException('Execution not found');
    const rows = await this.db.select().from(actionIntents).where(and(eq(actionIntents.executionId, executionId), eq(actionIntents.userId, userId)));
    return Promise.all(rows.map((row) => this.get(userId, row.id)));
  }
}
