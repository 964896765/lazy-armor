import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { approvalDecisions, approvalRequests, executionSteps, executions } from '@lazy-armor/database';
import { canonicalStringify, type NormalizedAction, type RiskLevel } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { RiskEngine } from '../risk/risk-engine.service';
import { SafetyPolicyService } from '../risk/safety-policy.service';
import type { ResolvedApprovalPolicy, RiskSnapshot } from '../risk/risk.types';
import { TemporaryAuthorizationService } from '../approvals/temporary-authorization.service';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionRuntimeError } from './execution.types';
import { ExecutionStateService } from './execution-state.service';

@Injectable()
export class ExecutionApprovalGate {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly risk: RiskEngine,
    private readonly policies: SafetyPolicyService,
    private readonly authorizations: TemporaryAuthorizationService,
    private readonly notifications: NotificationService,
    private readonly states: ExecutionStateService,
    private readonly events: ExecutionEventService,
    private readonly audit: AuditService,
  ) {}

  async check(input: {
    execution: { id: string; userId: string; planId: string; planVersionId: string; triggerPayloadJson: Record<string, unknown>; resolvedApprovalPolicyJson: Record<string, unknown> | null };
    step: typeof executionSteps.$inferSelect;
    action: NormalizedAction;
  }): Promise<{ allowed: boolean; effectiveRisk: RiskLevel }> {
    const snapshot = input.step.riskSnapshotJson as unknown as RiskSnapshot | null;
    if (!snapshot || !input.step.inputFingerprint || !input.step.effectiveRiskLevel) throw new ExecutionRuntimeError('RISK_SNAPSHOT_MISSING', 'ExecutionStep has no immutable Risk Snapshot');
    const current = await this.risk.evaluate(input.action, input.step.declaredRiskLevel as RiskLevel, input.execution.triggerPayloadJson, input.step.connectorId);
    if (current.inputFingerprint !== input.step.inputFingerprint || current.effectiveRisk !== input.step.effectiveRiskLevel || snapshot.policyVersion !== current.policyVersion) {
      throw new ExecutionRuntimeError('RISK_CONTEXT_CHANGED', 'Risk or approval input changed after Execution creation');
    }
    const policy = input.execution.resolvedApprovalPolicyJson as unknown as ResolvedApprovalPolicy;
    const authorization = await this.authorizations.match({ userId: input.execution.userId, planVersionId: input.execution.planVersionId, connectionId: input.step.connectionId, capabilityKey: input.step.requiredCapability, actionType: input.step.actionType, risk: current.effectiveRisk, amountMinor: current.amountMinor, currency: current.currency });
    const requirement = await this.policies.requiresApproval(input.execution.userId, input.step.planActionId, current.effectiveRisk, current.amountMinor, current.currency, policy, Boolean(authorization));
    const prior = (await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.executionId, input.execution.id), eq(approvalRequests.executionStepId, input.step.id))).limit(1))[0];
    if (!requirement.required) {
      if (input.step.approvalGateStatus !== 'not_required' && input.step.approvalGateStatus !== 'authorized') {
        await this.db.update(executionSteps).set({ approvalGateStatus: authorization ? 'authorized' : 'not_required', updatedAt: new Date() }).where(eq(executionSteps.id, input.step.id));
      }
      if (authorization) await this.events.append(input.execution.id, 'temporary_authorization_matched', { authorizationId: authorization.id, risk: current.effectiveRisk }, input.step.id);
      return { allowed: true, effectiveRisk: current.effectiveRisk };
    }
    if (prior?.status === 'approved') {
      if (prior.expiresAt <= new Date() || prior.inputFingerprint !== current.inputFingerprint || prior.contextHash !== this.contextHash(input, current)) throw new ExecutionRuntimeError('APPROVAL_NOT_VALID', 'Approval is expired or no longer matches the action context');
      if (input.step.approvalGateStatus !== 'approved') await this.db.update(executionSteps).set({ approvalGateStatus: 'approved', updatedAt: new Date() }).where(eq(executionSteps.id, input.step.id));
      return { allowed: true, effectiveRisk: current.effectiveRisk };
    }
    if (prior && prior.status !== 'pending') throw new ExecutionRuntimeError('APPROVAL_NOT_VALID', `Approval is ${prior.status}`);
    if (prior && prior.expiresAt <= new Date()) throw new ExecutionRuntimeError('APPROVAL_EXPIRED', 'Approval request expired');
    const request = prior ?? await this.createRequest(input, current, requirement.reasons);
    const execution = (await this.db.select({ status: executions.status }).from(executions).where(eq(executions.id, input.execution.id)).limit(1))[0];
    if (execution?.status === 'running') await this.states.transition(input.execution.id, 'waiting_approval', { workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
    await this.events.append(input.execution.id, 'approval_waiting', { approvalRequestId: request.id, risk: current.effectiveRisk }, input.step.id);
    return { allowed: false, effectiveRisk: current.effectiveRisk };
  }

  async cancelPending(executionId: string, userId: string) {
    const pending = await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.executionId, executionId), eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending')));
    for (const request of pending) {
      await this.db.transaction(async (tx) => {
        const current = (await tx.select({ status: approvalRequests.status }).from(approvalRequests).where(eq(approvalRequests.id, request.id)).limit(1).for('update'))[0];
        if (current?.status !== 'pending') return;
        const now = new Date();
        await tx.insert(approvalDecisions).values({ id: newId(), approvalRequestId: request.id, actorUserId: userId, decision: 'cancelled', reason: 'Execution cancelled', deviceContextJson: { source: 'execution_cancellation' }, createdAt: now });
        await tx.update(approvalRequests).set({ status: 'cancelled', decidedAt: now, decision: 'cancelled', decisionReason: 'Execution cancelled', updatedAt: now }).where(eq(approvalRequests.id, request.id));
        await tx.update(executionSteps).set({ approvalGateStatus: 'cancelled', updatedAt: now }).where(eq(executionSteps.id, request.executionStepId));
        await tx.update(executions).set({ approvalStatus: 'cancelled', updatedAt: now }).where(eq(executions.id, executionId));
        await this.audit.append({
          actorType: 'user', actorUserId: userId, action: 'APPROVAL_CANCELLED', resourceType: 'approval_request', resourceId: request.id,
          userId, executionId, executionStepId: request.executionStepId, approvalRequestId: request.id,
          correlationId: executionId, causationId: request.id, changeSummary: 'Approval cancelled with Execution', source: 'approval', result: 'success',
        }, tx);
      });
    }
  }

  contextHash(input: { execution: { id: string; planVersionId: string }; step: { id: string; planActionId: string } }, risk: RiskSnapshot) {
    return createHash('sha256').update(canonicalStringify({ executionId: input.execution.id, planVersionId: input.execution.planVersionId, stepId: input.step.id, planActionId: input.step.planActionId, inputFingerprint: risk.inputFingerprint, effectiveRisk: risk.effectiveRisk, amountMinor: risk.amountMinor, currency: risk.currency })).digest('hex');
  }

  private async createRequest(input: Parameters<ExecutionApprovalGate['check']>[0], risk: RiskSnapshot, reasons: string[]) {
    const id = newId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (process.env.NODE_ENV === 'test' ? 2_000 : (risk.effectiveRisk === 'R4' ? 5 : 15) * 60_000));
    const actionSummary = this.summary(input.action, risk);
    const reason = reasons.includes('system_risk_floor')
      ? `系统安全底线要求 ${risk.effectiveRisk} 动作必须经你确认`
      : `当前计划的确认策略（${(input.execution.resolvedApprovalPolicyJson as unknown as ResolvedApprovalPolicy).type}）要求本次执行经你确认`;
    // ApprovalRequest + Step waiting_approval + Execution waiting_approval 标记 + P1 Notification 尽量同事务落库。
    await this.db.transaction(async (tx) => {
      await tx.insert(approvalRequests).values({
        id, userId: input.execution.userId, executionId: input.execution.id, executionStepId: input.step.id, planId: input.execution.planId, planVersionId: input.execution.planVersionId, planActionId: input.step.planActionId,
        actionType: input.step.actionType, policySnapshotJson: input.execution.resolvedApprovalPolicyJson, reason, requestedAt: now,
        inputFingerprint: risk.inputFingerprint, contextHash: this.contextHash(input, risk), effectiveRiskLevel: risk.effectiveRisk, amountMinor: risk.amountMinor, currency: risk.currency,
        actionSummary, status: 'pending', expiresAt, decidedAt: null, decision: null, decisionReason: null, createdAt: now, updatedAt: now,
      }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
      const persisted = (await tx.select({ id: approvalRequests.id }).from(approvalRequests).where(and(eq(approvalRequests.executionId, input.execution.id), eq(approvalRequests.executionStepId, input.step.id))).limit(1))[0]!;
      await tx.update(executionSteps).set({ approvalGateStatus: 'waiting_approval', updatedAt: now }).where(eq(executionSteps.id, input.step.id));
      await tx.update(executions).set({ approvalStatus: 'pending', updatedAt: now }).where(eq(executions.id, input.execution.id));
      await this.notifications.emit({
        userId: input.execution.userId, executionId: input.execution.id, executionStepId: input.step.id, approvalRequestId: persisted.id, priority: 'P1', eventType: 'approval_required', actionType: input.step.actionType,
        dedupeKey: `approval-required:${input.step.id}`, title: '需要你的确认', body: actionSummary, actionRequired: true,
        messageParams: { summary: actionSummary, risk: risk.effectiveRisk, reason },
      }, tx);
      await this.audit.append({
        actorType: 'system', actorUserId: null, action: 'APPROVAL_REQUESTED', resourceType: 'approval_request', resourceId: persisted.id,
        userId: input.execution.userId, executionId: input.execution.id, executionStepId: input.step.id, approvalRequestId: persisted.id,
        correlationId: input.execution.id, causationId: input.step.id, changeSummary: actionSummary, source: 'execution_worker', result: 'pending',
      }, tx);
    });
    return (await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.executionId, input.execution.id), eq(approvalRequests.executionStepId, input.step.id))).limit(1))[0]!;
  }

  private summary(action: NormalizedAction, risk: RiskSnapshot) {
    const labels: Record<string, string> = { publish: '将内容发布到外部平台', create_order: '将创建外部订单', sync: '将数据同步到外部服务', prepare_purchase: '将准备购买操作', update_internal_record: '将更新内部记录' };
    const amount = risk.amountMinor === null ? '' : `，金额 ${(risk.amountMinor / 100).toFixed(2)} ${risk.currency ?? ''}`;
    return `${labels[action.actionType] ?? `将执行 ${action.actionType}`}（风险 ${risk.effectiveRisk}${amount}）`;
  }
}
