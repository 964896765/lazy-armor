import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { approvalRequests, connections, connectors, executions, notifications, planActions, planSources, planVersions, plans } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gte, inArray, ne, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { NotificationPolicyService } from './notification-policy.service';

export type NotificationPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TodayPresentationCategory = 'attention' | 'exception' | 'summary';

export interface NotificationEmitInput {
  userId: string;
  executionId?: string | null;
  executionStepId?: string | null;
  approvalRequestId?: string | null;
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
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly policy: NotificationPolicyService) {}

  async emit(input: NotificationEmitInput, executor: Pick<InjectedDatabase, 'insert' | 'select'> = this.db) {
    const priority = this.policy.resolve(input.eventType, input.priority);
    // P3 静默：不落通知表，只留在 Execution Record（成功的自动化应该安静）。
    if (priority === 'P3') return null;
    const now = new Date();
    await executor.insert(notifications).values({
      id: newId(), userId: input.userId, executionId: input.executionId ?? null, executionStepId: input.executionStepId ?? null, approvalRequestId: input.approvalRequestId ?? null,
      priority, eventType: input.eventType, titleKey: input.titleKey ?? `notification.${input.eventType}.title`, messageKey: input.messageKey ?? `notification.${input.eventType}.message`,
      messageParamsJson: input.messageParams ?? null, actionType: input.actionType ?? null,
      dedupeKey: input.dedupeKey, title: input.title.slice(0, 160), body: input.body.slice(0, 1000),
      actionRequired: input.actionRequired ? 1 : 0, status: 'unread', readAt: null, archivedAt: null, createdAt: now, updatedAt: now,
    }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
    return (await executor.select().from(notifications).where(and(eq(notifications.userId, input.userId), eq(notifications.dedupeKey, input.dedupeKey))).limit(1))[0];
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
    return {
      pendingApprovals,
      connectionIssues: [...uniqueIssues.values()],
      alerts: alerts.map((item) => ({
        id: item.id,
        priority: item.priority,
        title: item.title,
        body: item.body,
        executionId: item.executionId,
        createdAt: item.createdAt,
        category: this.classifyTodayCategory(item.eventType, item.priority as NotificationPriority, Boolean(item.actionRequired)),
      })),
      processed,
    };
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
