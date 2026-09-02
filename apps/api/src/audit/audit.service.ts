import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { auditLogs, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
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

  async listSecurityActivity(userId: string) {
    const actions = [
      'LOGIN_SUCCESS',
      'LOGOUT',
      'PASSWORD_CHANGED',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET_COMPLETED',
      'CONNECTION_PROVIDER_REVOKE_FAILED',
      'CONNECTION_REVOKED',
      'CONNECTION_OAUTH_STARTED',
      'CONNECTION_OAUTH_COMPLETED',
      'PERMISSION_CHANGE',
      'PLAN_EXECUTION_BLOCKED',
      'SIDE_EFFECT_PAYLOAD_INTEGRITY_FAILURE',
      'EXECUTION_BLOCKED',
    ];
    const rows = await this.db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      result: auditLogs.result,
      reasonCode: auditLogs.reasonCode,
      changeSummary: auditLogs.changeSummary,
      createdAt: auditLogs.createdAt,
    })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), inArray(auditLogs.action, actions)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      type: this.securityType(row.action),
      title: this.securityTitle(row.action, row.result as AuditResult),
      summary: this.securitySummary(row.action, row.changeSummary, row.reasonCode),
      status: row.result,
      createdAt: row.createdAt.toISOString(),
      resourceType: row.resourceType,
      resourceId: row.resourceId,
    }));
  }

  private securityType(action: string) {
    if (action.startsWith('AUTH_')) return 'login';
    if (action.startsWith('CONNECTION_')) return 'connection';
    if (action === 'PERMISSION_CHANGE') return 'permission';
    if (action.includes('BLOCKED') || action.includes('INTEGRITY_FAILURE')) return 'security_block';
    return 'security_event';
  }

  private securityTitle(action: string, result: AuditResult) {
    switch (action) {
      case 'LOGIN_SUCCESS': return '账号已登录';
      case 'LOGOUT': return '账号已退出';
      case 'PASSWORD_CHANGED': return '密码已更新';
      case 'PASSWORD_RESET_REQUESTED': return '已申请重置密码';
      case 'PASSWORD_RESET_COMPLETED': return '密码重置已完成';
      case 'CONNECTION_OAUTH_STARTED': return '开始连接账号';
      case 'CONNECTION_OAUTH_COMPLETED': return '账号连接成功';
      case 'CONNECTION_REVOKED': return '账号已断开';
      case 'CONNECTION_PROVIDER_REVOKE_FAILED': return '服务端断开回执异常';
      case 'PERMISSION_CHANGE': return result === 'success' ? '权限已更新' : '权限更新失败';
      case 'PLAN_EXECUTION_BLOCKED':
      case 'EXECUTION_BLOCKED': return '高风险或权限问题已被拦下';
      case 'SIDE_EFFECT_PAYLOAD_INTEGRITY_FAILURE': return '系统拦下了一次异常外发';
      default: return '安全事件';
    }
  }

  private securitySummary(action: string, changeSummary: string | null, reasonCode: string | null) {
    if (action === 'PERMISSION_CHANGE') return '某项连接权限刚刚发生变化，相关计划会立即使用新的授权状态。';
    if (action === 'CONNECTION_PROVIDER_REVOKE_FAILED') return '本地已经断开连接，外部服务回执稍后会继续受控处理。';
    if (action === 'PLAN_EXECUTION_BLOCKED' || action === 'EXECUTION_BLOCKED') return '系统发现当前条件不安全，已自动阻断这次执行。';
    if (action === 'SIDE_EFFECT_PAYLOAD_INTEGRITY_FAILURE') return '系统发现外发数据异常，已阻断并保留审计记录。';
    if (changeSummary) return this.sanitizer.sanitizeText(changeSummary);
    if (reasonCode) return this.sanitizer.sanitizeText(reasonCode);
    return '已记录这次重要安全事件。';
  }
}
