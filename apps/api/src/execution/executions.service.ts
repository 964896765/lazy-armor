import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { executionEvents, executionSteps, executions, planVersions, plans, approvalRequests, notifications } from '@lazy-armor/database';
import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../infrastructure/queue.service';
import { ExecutionStateService } from './execution-state.service';
import { EXECUTION_TERMINAL_STATES, type ExecutionStatus } from './execution.types';
import type { ListExecutionsDto } from './dto';
import { ExecutionApprovalGate } from './execution-approval-gate.service';

@Injectable()
export class ExecutionsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly states: ExecutionStateService,
    private readonly queue: QueueService,
    private readonly approvalGate: ExecutionApprovalGate,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: ListExecutionsDto = { limit: 50, offset: 0 }) {
    const filters: SQL[] = [eq(executions.userId, userId)];
    if (query.status) filters.push(eq(executions.status, query.status));
    if (query.planId) filters.push(eq(executions.planId, query.planId));
    if (query.from) filters.push(gte(executions.createdAt, new Date(query.from)));
    if (query.to) filters.push(lte(executions.createdAt, new Date(query.to)));
    return this.db.select({
      id: executions.id, planId: executions.planId, planVersionId: executions.planVersionId, planName: planVersions.name,
      status: executions.status, resultCode: executions.resultCode, resultSummary: executions.resultSummary,
      errorCode: executions.errorCode, errorMessage: executions.errorMessage, createdAt: executions.createdAt,
      startedAt: executions.startedAt, finishedAt: executions.finishedAt,
    }).from(executions).innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
      .where(and(...filters)).orderBy(desc(executions.createdAt)).limit(query.limit).offset(query.offset);
  }

  async listForPlan(userId: string, planId: string) {
    await this.assertOwnedPlan(userId, planId);
    return this.list(userId, { planId, limit: 100, offset: 0 });
  }

  async get(userId: string, id: string) {
    const rows = await this.db.select({
      id: executions.id, userId: executions.userId, planId: executions.planId, planVersionId: executions.planVersionId,
      planName: planVersions.name, planVersionNumber: planVersions.versionNumber, definitionHash: executions.definitionHash, requestId: executions.requestId,
      retryOfExecutionId: executions.retryOfExecutionId, triggerType: executions.triggerType, status: executions.status,
      declaredRiskLevel: executions.declaredRiskLevel, approvalStatus: executions.approvalStatus,
      riskPolicyVersion: executions.riskPolicyVersion, resolvedRiskSnapshotJson: executions.resolvedRiskSnapshotJson, resolvedApprovalPolicyJson: executions.resolvedApprovalPolicyJson,
      executionPolicyVersion: executions.executionPolicyVersion, resultCode: executions.resultCode, resultSummary: executions.resultSummary,
      errorCode: executions.errorCode, errorMessage: executions.errorMessage, cancellationRequestedAt: executions.cancellationRequestedAt,
      queuedAt: executions.queuedAt, startedAt: executions.startedAt, finishedAt: executions.finishedAt, createdAt: executions.createdAt,
    }).from(executions).innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
      .where(and(eq(executions.id, id), eq(executions.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Execution not found');
    const [steps, events, approvals, detailNotifications] = await Promise.all([
      this.db.select().from(executionSteps).where(eq(executionSteps.executionId, id)).orderBy(asc(executionSteps.stepOrder)),
      this.db.select().from(executionEvents).where(eq(executionEvents.executionId, id)).orderBy(asc(executionEvents.createdAt)),
      this.db.select({
        id: approvalRequests.id, executionStepId: approvalRequests.executionStepId, status: approvalRequests.status,
        effectiveRiskLevel: approvalRequests.effectiveRiskLevel, actionSummary: approvalRequests.actionSummary,
        reason: approvalRequests.reason, requestedAt: approvalRequests.requestedAt, expiresAt: approvalRequests.expiresAt,
        decidedAt: approvalRequests.decidedAt, decision: approvalRequests.decision, decisionReason: approvalRequests.decisionReason,
      }).from(approvalRequests).where(eq(approvalRequests.executionId, id)).orderBy(asc(approvalRequests.createdAt)),
      this.db.select({
        id: notifications.id, priority: notifications.priority, eventType: notifications.eventType, title: notifications.title,
        body: notifications.body, status: notifications.status, createdAt: notifications.createdAt,
      }).from(notifications).where(eq(notifications.executionId, id)).orderBy(asc(notifications.createdAt)).limit(20),
    ]);
    const outputs = steps
      .filter((step) => step.outputSnapshotJson !== null)
      .map((step) => ({
        stepOrder: step.stepOrder,
        actionType: step.actionType,
        status: step.status,
        output: step.outputSnapshotJson,
      }));
    return { ...rows[0], steps, outputs, events, approvals, notifications: detailNotifications };
  }

  async cancel(userId: string, id: string) {
    const execution = await this.getOwnedRow(userId, id);
    if (EXECUTION_TERMINAL_STATES.has(execution.status as ExecutionStatus)) return this.get(userId, id);
    const previous = await this.states.requestCancellation(id);
    if (['created', 'queued', 'retry_wait', 'waiting_approval'].includes(previous)) {
      if (previous === 'waiting_approval') await this.approvalGate.cancelPending(id, userId);
      await this.states.transition(id, 'cancelled', { resultCode: 'CANCELLED_BY_USER', resultSummary: 'Execution cancelled before the next step', finishedAt: new Date() });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'EXECUTION_CANCELLED', resourceType: 'execution', resourceId: id, userId, executionId: id, correlationId: execution.requestId, changeSummary: 'Execution cancelled by user', source: 'api', result: 'success' });
      await this.queue.removeExecutionJob(id);
    }
    return this.get(userId, id);
  }

  private async getOwnedRow(userId: string, id: string) {
    const rows = await this.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Execution not found');
    return rows[0];
  }

  private async assertOwnedPlan(userId: string, planId: string) {
    const rows = await this.db.select({ id: plans.id }).from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Plan not found');
  }
}
