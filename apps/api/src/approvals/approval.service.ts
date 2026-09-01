import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { approvalDecisions, approvalRequests, executionSteps, executions, planVersions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionApprovalGate } from '../execution/execution-approval-gate.service';
import { ExecutionEventService } from '../execution/execution-event.service';
import { ExecutionPolicyService } from '../execution/execution-policy.service';
import { ExecutionResultResolver } from '../execution/execution-result-resolver.service';
import { ExecutionStateService } from '../execution/execution-state.service';
import { ExecutionStepStateService } from '../execution/execution-step-state.service';
import { FallbackExecutor } from '../execution/fallback-executor.service';
import { QueueService } from '../infrastructure/queue.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';

type Decision = 'approved' | 'rejected' | 'expired';

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly gate: ExecutionApprovalGate,
    private readonly states: ExecutionStateService,
    private readonly stepStates: ExecutionStepStateService,
    private readonly fallback: FallbackExecutor,
    private readonly resultResolver: ExecutionResultResolver,
    private readonly executionPolicy: ExecutionPolicyService,
    private readonly queue: QueueService,
    private readonly events: ExecutionEventService,
    private readonly notifications: NotificationService,
    private readonly assembler: PlanDefinitionAssembler,
    private readonly audit: AuditService,
  ) {}

  list(userId: string, status?: string) {
    const filters = [eq(approvalRequests.userId, userId)];
    if (status) filters.push(eq(approvalRequests.status, status));
    return this.db.select({ id: approvalRequests.id, executionId: approvalRequests.executionId, executionStepId: approvalRequests.executionStepId, status: approvalRequests.status, effectiveRiskLevel: approvalRequests.effectiveRiskLevel, actionSummary: approvalRequests.actionSummary, expiresAt: approvalRequests.expiresAt, createdAt: approvalRequests.createdAt, planName: planVersions.name })
      .from(approvalRequests).innerJoin(planVersions, eq(approvalRequests.planVersionId, planVersions.id)).where(and(...filters)).orderBy(desc(approvalRequests.createdAt)).limit(100);
  }

  async get(userId: string, id: string) {
    const request = (await this.db.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), eq(approvalRequests.userId, userId))).limit(1))[0];
    if (!request) throw new NotFoundException('Approval Request not found');
    const decisions = await this.db.select().from(approvalDecisions).where(eq(approvalDecisions.approvalRequestId, id)).orderBy(asc(approvalDecisions.createdAt));
    return { ...request, decisions };
  }

  approve(userId: string, id: string, input: { reason?: string; deviceId?: string; confirmation?: string }) { return this.decide(userId, id, 'approved', input); }
  reject(userId: string, id: string, input: { reason?: string; deviceId?: string }) { return this.decide(userId, id, 'rejected', input); }

  async expireDue() {
    const due = await this.db.select({ id: approvalRequests.id, userId: approvalRequests.userId }).from(approvalRequests).where(and(eq(approvalRequests.status, 'pending'), lte(approvalRequests.expiresAt, new Date()))).limit(100);
    for (const request of due) {
      try { await this.decide(request.userId, request.id, 'expired', { reason: 'Approval window expired', deviceId: 'system' }); } catch (error) { if (!(error instanceof ConflictException)) throw error; }
    }
    return { expired: due.length };
  }

  private async decide(userId: string, id: string, decision: Decision, input: { reason?: string; deviceId?: string; confirmation?: string }) {
    let request!: typeof approvalRequests.$inferSelect;
    let execution!: typeof executions.$inferSelect;
    let step!: typeof executionSteps.$inferSelect;
    await this.db.transaction(async (tx) => {
      request = (await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), eq(approvalRequests.userId, userId))).limit(1).for('update'))[0]!;
      if (!request) throw new NotFoundException('Approval Request not found');
      if (request.status !== 'pending') throw new ConflictException(`Approval Request is already ${request.status}`);
      if (request.expiresAt <= new Date() && decision !== 'expired') throw new ConflictException('Approval Request has expired');
      if (request.effectiveRiskLevel === 'R4' && decision === 'approved' && input.confirmation !== 'APPROVE_R4') throw new BadRequestException('R4 requires explicit strong confirmation');
      execution = (await tx.select().from(executions).where(and(eq(executions.id, request.executionId), eq(executions.userId, userId))).limit(1).for('update'))[0]!;
      step = (await tx.select().from(executionSteps).where(eq(executionSteps.id, request.executionStepId)).limit(1).for('update'))[0]!;
      if (!execution || !step || execution.status !== 'waiting_approval') throw new ConflictException('Execution is no longer waiting for approval');
      if (step.inputFingerprint !== request.inputFingerprint || request.contextHash !== this.gate.contextHash({ execution, step }, step.riskSnapshotJson as never)) throw new ConflictException('Approval context fingerprint mismatch');
      const assembled = await this.assembler.assembleById(userId, execution.planId, execution.planVersionId, tx);
      if (assembled.computedHash !== execution.definitionHash || assembled.version.definitionHash !== execution.definitionHash) throw new ConflictException('PlanVersion integrity check failed');
      const now = new Date();
      const decisionReason = input.reason ?? (decision === 'expired' ? 'Approval window expired' : decision === 'rejected' ? 'User rejected this action' : null);
      await tx.insert(approvalDecisions).values({ id: newId(), approvalRequestId: id, actorUserId: userId, decision, reason: input.reason ?? null, deviceContextJson: { deviceId: input.deviceId ?? 'unknown', source: decision === 'expired' ? 'system' : 'user' }, createdAt: now });
      await tx.update(approvalRequests).set({ status: decision, decidedAt: now, decision, decisionReason, updatedAt: now }).where(eq(approvalRequests.id, id));
      await tx.update(executionSteps).set({ approvalGateStatus: decision, updatedAt: now }).where(eq(executionSteps.id, step.id));
      await tx.update(executions).set({ approvalStatus: decision, updatedAt: now }).where(eq(executions.id, execution.id));
      await this.audit.append({
        actorType: decision === 'expired' ? 'system' : 'user', actorUserId: decision === 'expired' ? null : userId,
        action: `APPROVAL_${decision.toUpperCase()}`, resourceType: 'approval_request', resourceId: id, userId,
        executionId: execution.id, executionStepId: step.id, approvalRequestId: id, correlationId: execution.requestId,
        causationId: id, changeSummary: decisionReason ?? undefined,
        source: decision === 'expired' ? 'scheduler' : 'approval', result: 'success',
      }, tx);
    });
    await this.events.append(execution.id, `approval_${decision}`, { approvalRequestId: id }, step.id);
    if (decision === 'approved') {
      await this.states.transition(execution.id, 'running');
      const retry = this.executionPolicy.resolveRetry(execution.resolvedRetryPolicyJson);
      await this.queue.resumeExecution(execution.id, retry);
      return this.get(userId, id);
    }
    const fallback = await this.fallback.execute(userId, execution.planId, execution.id, step.id, decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED', execution.resolvedFallbackPolicyJson);
    await this.stepStates.transition(step.id, fallback.stepStatus, { errorCode: decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED', errorMessage: decision === 'expired' ? 'Approval request expired' : 'User rejected this action', fallbackResultJson: fallback as unknown as Record<string, unknown>, finishedAt: new Date() });
    if (fallback.continueExecution) {
      await this.states.transition(execution.id, 'running');
      const retry = this.executionPolicy.resolveRetry(execution.resolvedRetryPolicyJson);
      await this.queue.resumeExecution(execution.id, retry);
    } else {
      const all = await this.db.select({ status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.executionId, execution.id));
      const aggregate = this.resultResolver.resolve(all);
      await this.states.transition(execution.id, aggregate, { resultCode: fallback.resultCode, resultSummary: fallback.resultSummary, errorCode: decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED', errorMessage: decision === 'expired' ? 'Approval request expired' : 'User rejected this action', finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
    }
    await this.notifications.emit({ userId, executionId: execution.id, executionStepId: step.id, approvalRequestId: id, priority: 'P2', eventType: `approval_${decision}`, actionType: step.actionType, dedupeKey: `approval-${decision}:${id}`, title: decision === 'expired' ? '确认已过期' : '已拒绝执行', body: request.actionSummary, messageParams: { summary: request.actionSummary, decision } });
    return this.get(userId, id);
  }
}
