import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { executions } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { ExecutionEventService } from './execution-event.service';
import { EXECUTION_TERMINAL_STATES, type ExecutionStatus } from './execution.types';

const TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = Object.freeze({
  created: ['queued', 'failed', 'cancelled'],
  queued: ['running', 'failed', 'cancelled'],
  running: ['waiting_approval', 'waiting_dispatch', 'retry_wait', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'],
  retry_wait: ['queued', 'running', 'failed', 'cancelled'],
  waiting_approval: ['running', 'partially_succeeded', 'failed', 'cancelled'],
  waiting_dispatch: ['queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'],
  succeeded: [], partially_succeeded: [], failed: [], cancelled: [],
});

@Injectable()
export class ExecutionStateService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly events: ExecutionEventService, private readonly audit: AuditService) {}

  async transition(id: string, target: ExecutionStatus, patch: Partial<typeof executions.$inferInsert> = {}) {
    let current: ExecutionStatus | undefined;
    let changed = false;
    let userId = '';
    let requestId: string | null = null;
    await this.db.transaction(async (tx) => {
      const rows = await tx.select({ status: executions.status, userId: executions.userId, requestId: executions.requestId }).from(executions).where(eq(executions.id, id)).limit(1).for('update');
      if (!rows[0]) throw new NotFoundException('Execution not found');
      current = rows[0].status as ExecutionStatus;
      userId = rows[0].userId;
      requestId = rows[0].requestId;
      if (current === target) return;
      if (EXECUTION_TERMINAL_STATES.has(current)) throw new ConflictException('Terminal Execution cannot be revived');
      if (!TRANSITIONS[current].includes(target)) throw new BadRequestException(`Illegal Execution state transition: ${current} -> ${target}`);
      await tx.update(executions).set({ ...patch, status: target, updatedAt: new Date() }).where(and(eq(executions.id, id), eq(executions.status, current)));
      changed = true;
      await this.events.append(id, 'execution_state_changed', { from: current, to: target }, null, tx);
      // 终态转换与 Audit 同事务（§35）。
      if (EXECUTION_TERMINAL_STATES.has(target)) {
        await this.audit.append({
          actorType: patch.workerToken ? 'worker' : 'user', actorUserId: userId, action: 'EXECUTION_TERMINAL',
          resourceType: 'execution', resourceId: id, userId, executionId: id, requestId, correlationId: requestId,
          causationId: patch.errorCode ?? null, changeSummary: `Execution reached terminal state ${target}`,
          after: { status: target, resultCode: patch.resultCode ?? null, errorCode: patch.errorCode ?? null },
          source: 'execution_worker', result: patch.errorCode ? 'failure' : 'success', reasonCode: patch.errorCode ?? null,
        }, tx);
      }
    });
    void changed;
    void userId;
  }

  async requestCancellation(id: string) {
    const rows = await this.db.select({ status: executions.status, cancellationRequestedAt: executions.cancellationRequestedAt }).from(executions).where(eq(executions.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundException('Execution not found');
    if (EXECUTION_TERMINAL_STATES.has(rows[0].status as ExecutionStatus)) return rows[0].status as ExecutionStatus;
    if (!rows[0].cancellationRequestedAt) {
      await this.db.update(executions).set({ cancellationRequestedAt: new Date(), updatedAt: new Date() }).where(eq(executions.id, id));
      await this.events.append(id, 'cancellation_requested');
    }
    return rows[0].status as ExecutionStatus;
  }
}
