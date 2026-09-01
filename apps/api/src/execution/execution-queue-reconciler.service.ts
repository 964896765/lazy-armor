import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { executions } from '@lazy-armor/database';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { QueueService } from '../infrastructure/queue.service';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionStateService } from './execution-state.service';

@Injectable()
export class ExecutionQueueReconciler implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly queue: QueueService,
    private readonly policy: ExecutionPolicyService,
    private readonly states: ExecutionStateService,
    private readonly events: ExecutionEventService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.reconcile().catch(() => undefined), 15_000);
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  async reconcile(staleBefore = new Date(Date.now() - 30_000)) {
    const candidates = await this.db.select({ id: executions.id, status: executions.status }).from(executions)
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
      recovered += 1;
    }
    return { scanned: candidates.length, recovered };
  }
}
