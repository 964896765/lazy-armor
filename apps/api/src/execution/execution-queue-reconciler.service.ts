import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { executions } from '@lazy-armor/database';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { QueueService } from '../infrastructure/queue.service';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionStateService } from './execution-state.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ExecutionQueueReconciler implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly queue: QueueService,
    private readonly policy: ExecutionPolicyService,
    private readonly states: ExecutionStateService,
    private readonly events: ExecutionEventService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.reconcile().catch(() => undefined), 15_000);
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  async reconcile(staleBefore = new Date(Date.now() - 30_000)) {
    const candidates = await this.db.select({
      id: executions.id,
      status: executions.status,
      userId: executions.userId,
      requestId: executions.requestId,
    }).from(executions)
      .where(or(
        and(or(eq(executions.status, 'created'), eq(executions.status, 'queued')), lt(executions.updatedAt, staleBefore)),
        and(eq(executions.status, 'running'), lt(executions.leaseExpiresAt, new Date())),
        and(eq(executions.status, 'running'), isNull(executions.workerToken), lt(executions.updatedAt, staleBefore)),
      ));
    let recovered = 0;
    for (const execution of candidates) {
      if (await this.queue.hasExecutionJob(execution.id)) continue;
      await this.queue.addExecution(execution.id, this.policy.current);
      if (execution.status === 'created') await this.states.transition(execution.id, 'queued', { queuedAt: new Date() });
      await this.events.append(execution.id, 'queue_reconciled', { jobId: execution.id });
      await this.audit.append({
        actorType: 'system',
        actorUserId: null,
        action: 'EXECUTION_RECOVERED',
        resourceType: 'execution',
        resourceId: execution.id,
        userId: execution.userId,
        executionId: execution.id,
        requestId: execution.requestId,
        correlationId: execution.requestId,
        changeSummary: `Execution re-queued by reconciler from ${execution.status}`,
        source: 'scheduler',
        result: 'success',
        reasonCode: execution.status === 'running' ? 'STALE_EXECUTION_RECOVERED' : 'QUEUE_RECONCILED',
      });
      recovered += 1;
    }
    return { scanned: candidates.length, recovered };
  }
}
