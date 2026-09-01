import { Inject, Injectable } from '@nestjs/common';
import { credentialRefs, executions, outboxMessages, sideEffectOperations } from '@lazy-armor/database';
import { and, count, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import type { AnyMySqlTable } from 'drizzle-orm/mysql-core';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

// §38/§39：卡死工作检测 + 基础运营指标（只返回聚合计数，不含用户数据）。
@Injectable()
export class DiagnosticsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async snapshot() {
    const now = new Date();
    const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [activeExecutions, failedExecutions, waitingApproval, waitingDispatch, pendingOutbox, deadOutbox, outcomeUnknown, staleCredentials, stuckExecutions] = await Promise.all([
      this.count(executions, eq(executions.status, 'running')),
      this.count(executions, and(eq(executions.status, 'failed'), gte(executions.updatedAt, recent))),
      this.count(executions, eq(executions.status, 'waiting_approval')),
      this.count(executions, eq(executions.status, 'waiting_dispatch')),
      this.count(outboxMessages, or(eq(outboxMessages.status, 'pending'), eq(outboxMessages.status, 'retry_wait'))),
      this.count(outboxMessages, eq(outboxMessages.status, 'dead')),
      this.count(sideEffectOperations, eq(sideEffectOperations.status, 'outcome_unknown')),
      this.count(credentialRefs, and(eq(credentialRefs.status, 'active'), lt(credentialRefs.expiresAt, now))),
      this.count(executions, and(eq(executions.status, 'running'), lt(executions.leaseExpiresAt, now))),
    ]);
    return {
      generatedAt: now.toISOString(),
      activeExecutions,
      failedExecutions24h: failedExecutions,
      waitingApproval,
      waitingDispatch,
      pendingOutbox,
      deadOutbox,
      outcomeUnknown,
      staleCredentials,
      stuckExecutions,
    };
  }

  private async count(table: AnyMySqlTable, condition: SQL | undefined): Promise<number> {
    const rows = await this.db.select({ n: count() }).from(table).where(condition);
    return Number(rows[0]?.n ?? 0);
  }
}
