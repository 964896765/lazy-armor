import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { approvalRequests, connections, connectors, executions, notifications, planActions, planSources, planVersions, plans, reconciliationCases } from '@lazy-armor/database';
import { projectConsumerOutcome, type ConsumerOutcomeProjection, type RuntimeResultState } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gte, inArray, ne, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { NotificationPolicyService } from './notification-policy.service';
import { UsageService } from '../usage/usage.service';

export type NotificationPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TodayPresentationCategory = 'attention' | 'exception' | 'summary';

/** Server-side outcome projection for a recent plan on the Today home screen. */
export interface TodayRecentPlan {
  planId: string;
  planName: string | null;
  planStatus: string;
  latestExecutionId: string | null;
  /** execution.status (actual internal state, not the projection). */
  executionStatus: string | null;
  approvalStatus: string | null;
  resultState: RuntimeResultState | null;
  consumerOutcome: ConsumerOutcomeProjection;
  /** Raw execution result summary (traceable, never rewritten). */
  resultSummary: string | null;
  /** Most recent meaningful activity: execution activity, else plan update. */
  lastActivityAt: string | null;
  /** Whether a confirmation/approval item still awaits the user. */
  hasPendingConfirmation: boolean;
  /** Whether the plan requires user attention (confirmation, unknown result, or failure). */
  needsUserAction: boolean;
}

export interface NotificationEmitInput {
  userId: string;
  executionId?: string | null;
  executionStepId?: string | null;
  approvalRequestId?: string | null;
  connectionId?: string | null;
  priority: NotificationPriority;
  eventType: string;
  actionType?: string | null;
  dedupeKey: string;
  title: string;
  body: string;
  titleKey?: string;
  messageKey?: string;
  messageParams?: Record<string, unknown>;
  actionRequired?: boolean;
}

@Injectable()
export class NotificationService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly policy: NotificationPolicyService, private readonly usage: UsageService) {}

  async emit(input: NotificationEmitInput, executor: Pick<InjectedDatabase, 'insert' | 'select'> = this.db) {
    const priority = this.policy.resolve(input.eventType, input.priority);
    // P3 静默：不落通知表，只留在 Execution Record（成功的自动化应该安静）。
    if (priority === 'P3') return null;
    const now = new Date();
    await executor.insert(notifications).values({
      id: newId(), userId: input.userId, executionId: input.executionId ?? null, executionStepId: input.executionStepId ?? null, approvalRequestId: input.approvalRequestId ?? null, connectionId: input.connectionId ?? null,
      priority, eventType: input.eventType, titleKey: input.titleKey ?? `notification.${input.eventType}.title`, messageKey: input.messageKey ?? `notification.${input.eventType}.message`,
      messageParamsJson: input.messageParams ?? null, actionType: input.actionType ?? null,
      dedupeKey: input.dedupeKey, title: input.title.slice(0, 160), body: input.body.slice(0, 1000),
      actionRequired: input.actionRequired ? 1 : 0, status: 'unread', readAt: null, archivedAt: null, createdAt: now, updatedAt: now,
    }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
    const notification = (await executor.select().from(notifications).where(and(eq(notifications.userId, input.userId), eq(notifications.dedupeKey, input.dedupeKey))).limit(1))[0];
    if (!notification) return null;
    const common = {
      userId: input.userId,
      quantity: 1,
      unit: 'notification',
      provider: 'in_app',
      resourceType: 'notification',
      resourceId: notification.id,
      executionId: input.executionId ?? null,
      billable: false,
    };
    await this.usage.record({ ...common, usageType: 'notification.generated', usageIdentity: 'notification.generated:' + notification.id }, executor);
    // In-app persistence is the delivery boundary for the current provider.
    await this.usage.record({ ...common, usageType: 'notification.delivered', usageIdentity: 'notification.delivered:' + notification.id }, executor);
    return notification;
  }

  list(userId: string, priority?: NotificationPriority, unreadOnly = false) {
    const filters = [eq(notifications.userId, userId), ne(notifications.status, 'archived')];
    if (priority) filters.push(eq(notifications.priority, priority));
    if (unreadOnly) filters.push(eq(notifications.status, 'unread'));
    return this.db.select().from(notifications).where(and(...filters)).orderBy(desc(notifications.createdAt)).limit(100);
  }

  async unreadCount(userId: string) {
    const rows = await this.db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.status, 'unread')));
    return { count: rows.length };
  }

  async markRead(userId: string, id: string) {
    const row = (await this.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Notification not found');
    if (row.status === 'unread') await this.db.update(notifications).set({ status: 'read', readAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, id));
    return (await this.db.select().from(notifications).where(eq(notifications.id, id)).limit(1))[0];
  }

  async archive(userId: string, id: string) {
    const row = (await this.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Notification not found');
    if (row.status !== 'archived') {
      const now = new Date();
      await this.db.update(notifications).set({ status: 'archived', archivedAt: now, readAt: row.readAt ?? now, updatedAt: now }).where(eq(notifications.id, id));
    }
    return (await this.db.select().from(notifications).where(eq(notifications.id, id)).limit(1))[0];
  }

  async today(userId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const issueStatuses = ['degraded', 'expired', 'permission_required', 'reauthorization_required', 'provider_error'];
    const [pendingApprovals, alerts, processed, sourceIssues, actionIssues] = await Promise.all([
      this.db.select({
        id: approvalRequests.id, executionId: approvalRequests.executionId, riskLevel: approvalRequests.effectiveRiskLevel,
        summary: approvalRequests.actionSummary, expiresAt: approvalRequests.expiresAt, planName: planVersions.name,
      }).from(approvalRequests).innerJoin(planVersions, eq(approvalRequests.planVersionId, planVersions.id))
        .where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending'))).orderBy(desc(approvalRequests.createdAt)).limit(50),
      this.db.select({
        id: notifications.id,
        priority: notifications.priority,
        title: notifications.title,
        body: notifications.body,
        executionId: notifications.executionId,
        approvalRequestId: notifications.approvalRequestId,
        connectionId: notifications.connectionId,
        createdAt: notifications.createdAt,
        eventType: notifications.eventType,
        actionRequired: notifications.actionRequired,
      })
        .from(notifications)
        .where(and(
          eq(notifications.userId, userId),
          eq(notifications.status, 'unread'),
          or(
            inArray(notifications.priority, ['P0', 'P1']),
            eq(notifications.actionRequired, 1),
            eq(notifications.eventType, 'daily_important_summary'),
          ),
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(50),
      this.db.select({ id: executions.id, status: executions.status, resultSummary: executions.resultSummary, finishedAt: executions.finishedAt, planName: planVersions.name, planVersionNumber: planVersions.versionNumber })
        .from(executions).innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
        .where(and(eq(executions.userId, userId), gte(executions.createdAt, since))).orderBy(desc(executions.createdAt)).limit(20),
      this.db.select({ connectionId: connections.id, connectionStatus: connections.status, providerKey: connectors.key, providerName: connectors.name, planId: plans.id, planName: planVersions.name })
        .from(planSources)
        .innerJoin(connections, eq(planSources.connectionId, connections.id))
        .innerJoin(connectors, eq(connections.connectorId, connectors.id))
        .innerJoin(planVersions, eq(planSources.planVersionId, planVersions.id))
        .innerJoin(plans, and(eq(plans.activeVersionId, planVersions.id), eq(plans.userId, userId), eq(plans.status, 'active')))
        .where(inArray(connections.status, issueStatuses)).limit(50),
      this.db.select({ connectionId: connections.id, connectionStatus: connections.status, providerKey: connectors.key, providerName: connectors.name, planId: plans.id, planName: planVersions.name })
        .from(planActions)
        .innerJoin(connections, eq(planActions.connectionId, connections.id))
        .innerJoin(connectors, eq(connections.connectorId, connectors.id))
        .innerJoin(planVersions, eq(planActions.planVersionId, planVersions.id))
        .innerJoin(plans, and(eq(plans.activeVersionId, planVersions.id), eq(plans.userId, userId), eq(plans.status, 'active')))
        .where(inArray(connections.status, issueStatuses)).limit(50),
    ]);
    const uniqueIssues = new Map<string, typeof sourceIssues[number]>();
    for (const issue of [...sourceIssues, ...actionIssues]) uniqueIssues.set(`${issue.planId}:${issue.connectionId}`, issue);
    const alertExecutionIds = [...new Set(alerts.map((item) => item.executionId).filter((id): id is NonNullable<typeof id> => Boolean(id)))];
    const reconciliation = alertExecutionIds.length === 0 ? [] : await this.db.select({ executionId: reconciliationCases.executionId, id: reconciliationCases.id })
      .from(reconciliationCases)
      .where(and(eq(reconciliationCases.userId, userId), inArray(reconciliationCases.executionId, alertExecutionIds)));
    const reconciliationByExecution = new Map(reconciliation.map((item) => [item.executionId, item.id]));
    return {
      pendingApprovals,
      connectionIssues: [...uniqueIssues.values()],
      alerts: alerts.map((item) => ({
        id: item.id,
        priority: item.priority,
        title: item.title,
        body: item.body,
        executionId: item.executionId,
        approvalRequestId: item.approvalRequestId,
        connectionId: item.connectionId,
        eventType: item.eventType,
        reconciliationCaseId: item.executionId ? (reconciliationByExecution.get(item.executionId) ?? null) : null,
        createdAt: item.createdAt,
        actionRequired: Boolean(item.actionRequired),
        category: this.classifyTodayCategory(item.eventType, item.priority as NotificationPriority, Boolean(item.actionRequired)),
      })),
      processed,
      recentPlans: await this.recentPlans(userId),
    };
  }

  /**
   * Server-side outcome projection for the user's most recent plans.
   * Resolves the latest execution (and its reconciliation/approval state) in
   * batched queries — no N+1 and strictly scoped to `userId`.
   */
  private async recentPlans(userId: string): Promise<TodayRecentPlan[]> {
    const planRows = await this.db.select({
      id: plans.id,
      status: plans.status,
      updatedAt: plans.updatedAt,
      currentVersionId: plans.currentVersionId,
      activeVersionId: plans.activeVersionId,
    }).from(plans)
      .where(and(eq(plans.userId, userId), ne(plans.status, 'archived')))
      .orderBy(desc(plans.updatedAt))
      .limit(10);

    if (planRows.length === 0) return [];

    const versionIds = [...new Set(planRows.flatMap((p) => [p.currentVersionId, p.activeVersionId]).filter((v): v is string => Boolean(v)))];
    const versionRows = versionIds.length
      ? await this.db.select({ id: planVersions.id, name: planVersions.name }).from(planVersions).where(inArray(planVersions.id, versionIds))
      : [];
    const nameByVersion = new Map(versionRows.map((v) => [v.id, v.name]));

    const planIds = planRows.map((p) => p.id);
    const execRows = await this.db.select({
      id: executions.id,
      planId: executions.planId,
      status: executions.status,
      approvalStatus: executions.approvalStatus,
      resultSummary: executions.resultSummary,
      createdAt: executions.createdAt,
      startedAt: executions.startedAt,
      finishedAt: executions.finishedAt,
    }).from(executions)
      .where(and(eq(executions.userId, userId), inArray(executions.planId, planIds)))
      .orderBy(desc(executions.createdAt));

    const latestByPlan = new Map<string, typeof execRows[number]>();
    for (const exec of execRows) {
      if (!latestByPlan.has(exec.planId)) latestByPlan.set(exec.planId, exec);
    }

    const latestExecIds = [...latestByPlan.values()].map((e) => e.id);

    const reconciliationRows = latestExecIds.length
      ? await this.db.select({
        executionId: reconciliationCases.executionId,
        status: reconciliationCases.status,
        resultState: reconciliationCases.resultState,
      }).from(reconciliationCases)
        .where(and(eq(reconciliationCases.userId, userId), inArray(reconciliationCases.executionId, latestExecIds)))
      : [];
    const reconciliationByExec = new Map<string, typeof reconciliationRows[number][]>();
    for (const row of reconciliationRows) {
      const list = reconciliationByExec.get(row.executionId) ?? [];
      list.push(row);
      reconciliationByExec.set(row.executionId, list);
    }

    const pendingApprovalRows = latestExecIds.length
      ? await this.db.select({ executionId: approvalRequests.executionId })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending'), inArray(approvalRequests.executionId, latestExecIds)))
      : [];
    const pendingApprovalByExec = new Set(pendingApprovalRows.map((r) => r.executionId));

    return planRows.map((plan) => {
      const name = nameByVersion.get(plan.currentVersionId ?? plan.activeVersionId ?? '') ?? null;
      const exec = latestByPlan.get(plan.id);
      if (!exec) {
        return {
          planId: plan.id,
          planName: name,
          planStatus: plan.status,
          latestExecutionId: null,
          executionStatus: null,
          approvalStatus: null,
          resultState: null,
          consumerOutcome: projectConsumerOutcome({ executionStatus: null, approvalStatus: null, resultState: null, reconciliationOpen: false, reconciliationNeedsUser: false }),
          resultSummary: null,
          lastActivityAt: plan.updatedAt.toISOString(),
          hasPendingConfirmation: false,
          needsUserAction: false,
        };
      }
      const cases = reconciliationByExec.get(exec.id) ?? [];
      const hasOutcomeUnknown = cases.some((c) => c.resultState === 'OUTCOME_UNKNOWN');
      const reconciliationOpen = cases.some((c) => c.status === 'OPEN' || c.status === 'RECONCILING');
      const reconciliationNeedsUser = cases.some((c) => c.status === 'NEEDS_USER');
      const resultState: RuntimeResultState | null = hasOutcomeUnknown ? 'OUTCOME_UNKNOWN'
        : exec.status === 'succeeded' ? 'SUCCEEDED'
        : exec.status === 'failed' ? 'FAILED'
        : exec.status === 'partially_succeeded' ? 'PARTIALLY_SUCCEEDED'
        : null;
      const hasPendingConfirmation = exec.approvalStatus === 'pending' || exec.status === 'waiting_approval' || pendingApprovalByExec.has(exec.id);
      const outcome = projectConsumerOutcome({
        executionStatus: exec.status,
        approvalStatus: exec.approvalStatus,
        resultState,
        reconciliationOpen,
        reconciliationNeedsUser,
      });
      return {
        planId: plan.id,
        planName: name,
        planStatus: plan.status,
        latestExecutionId: exec.id,
        executionStatus: exec.status,
        approvalStatus: exec.approvalStatus,
        resultState,
        consumerOutcome: outcome,
        resultSummary: exec.resultSummary,
        lastActivityAt: (exec.finishedAt ?? exec.startedAt ?? exec.createdAt).toISOString(),
        hasPendingConfirmation,
        needsUserAction: outcome.outcome === 'PENDING_CONFIRMATION' || outcome.outcome === 'OUTCOME_UNKNOWN' || outcome.outcome === 'FAILED',
      };
    });
  }

  private classifyTodayCategory(eventType: string, priority: NotificationPriority, actionRequired: boolean): TodayPresentationCategory {
    if (actionRequired) return 'attention';
    if (eventType === 'daily_important_summary') return 'summary';
    if (eventType === 'approval_required' || eventType === 'permission_revoked' || eventType === 'connection_reconnect_required') {
      return 'attention';
    }
    if (priority === 'P0' || priority === 'P1') return 'exception';
    return 'summary';
  }
}
