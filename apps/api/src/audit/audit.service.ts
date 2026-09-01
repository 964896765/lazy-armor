import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { auditLogs, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';

export type AuditActorType = 'user' | 'system' | 'worker' | 'outbox_worker' | 'admin';
export type AuditResult = 'success' | 'failure' | 'blocked' | 'unknown' | 'pending';
export type AuditSource = 'api' | 'execution_worker' | 'outbox_worker' | 'system' | 'scheduler' | 'approval' | 'side_effect';

export interface AuditEntryInput {
  actorType: AuditActorType;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  userId?: string | null;
  executionId?: string | null;
  executionStepId?: string | null;
  approvalRequestId?: string | null;
  sideEffectOperationId?: string | null;
  outboxMessageId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  before?: unknown;
  after?: unknown;
  changeSummary?: string;
  source: AuditSource;
  result: AuditResult;
  reasonCode?: string | null;
}

export type AuditExecutor = Pick<InjectedDatabase, 'insert'>;

// 正式 Audit：append-only。本服务不提供 update/delete。
@Injectable()
export class AuditService implements OnModuleInit {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly sanitizer: SnapshotSanitizer) {}

  async onModuleInit() {
    // 系统正式启用审计的时间锚点（幂等，不伪造历史）。
    if (process.env.NODE_ENV === 'test') return;
    const [anchor] = await this.db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'AUDIT_SYSTEM_ENABLED')).limit(1);
    if (anchor) return;
    const [user] = await this.db.select({ id: users.id }).from(users).limit(1);
    if (!user) return;
    const now = new Date();
    await this.db.insert(auditLogs).values({
      id: newId(),
      actorType: 'system', actorUserId: null, action: 'AUDIT_SYSTEM_ENABLED',
      resourceType: 'system', resourceId: 'audit', userId: user.id,
      requestId: null, correlationId: 'audit-system-anchor', causationId: null,
      beforeSnapshotJson: null, afterSnapshotJson: null,
      changeSummary: 'P0-7 Audit foundation enabled; earlier history stays in its original event types',
      source: 'system', result: 'success', reasonCode: null, createdAt: now,
    });
  }

  async append(entry: AuditEntryInput, executor: AuditExecutor = this.db) {
    const now = new Date();
    await executor.insert(auditLogs).values({
      id: newId(),
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      userId: entry.userId ?? null,
      executionId: entry.executionId ?? null,
      executionStepId: entry.executionStepId ?? null,
      approvalRequestId: entry.approvalRequestId ?? null,
      sideEffectOperationId: entry.sideEffectOperationId ?? null,
      outboxMessageId: entry.outboxMessageId ?? null,
      requestId: entry.requestId ?? null,
      correlationId: entry.correlationId ?? null,
      causationId: entry.causationId ?? null,
      beforeSnapshotJson: entry.before === undefined ? null : this.sanitizer.sanitize(entry.before),
      afterSnapshotJson: entry.after === undefined ? null : this.sanitizer.sanitize(entry.after),
      changeSummary: entry.changeSummary ? this.sanitizer.sanitizeText(entry.changeSummary).slice(0, 1000) : null,
      source: entry.source,
      result: entry.result,
      reasonCode: entry.reasonCode ?? null,
      createdAt: now,
    });
  }
}
