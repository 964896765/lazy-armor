import { Inject, Injectable } from '@nestjs/common';
import { executionSteps, executions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionStepStateService } from './execution-step-state.service';
import { EXECUTION_TERMINAL_STATES, type ExecutionStatus } from './execution.types';

@Injectable()
export class ExecutionLeaseService {
  readonly leaseDurationMs = process.env.NODE_ENV === 'test' ? 1_000 : 30_000;
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly events: ExecutionEventService,
    private readonly stepStates: ExecutionStepStateService,
  ) {}

  async acquire(executionId: string, workerId = `execution-${process.pid}`) {
    const workerToken = newId();
    let status: ExecutionStatus = 'created';
    let recovered = false;
    let acquired = false;
    let previousWorkerPresent = false;
    await this.db.transaction(async (tx) => {
      const rows = await tx.select({ status: executions.status, workerToken: executions.workerToken, leaseExpiresAt: executions.leaseExpiresAt })
        .from(executions).where(eq(executions.id, executionId)).limit(1).for('update');
      if (!rows[0]) return;
      status = rows[0].status as ExecutionStatus;
      if (EXECUTION_TERMINAL_STATES.has(status)) return;
      const now = new Date();
      if (rows[0].workerToken && rows[0].leaseExpiresAt && rows[0].leaseExpiresAt > now) return;
      recovered = status === 'running' && Boolean(rows[0].workerToken);
      previousWorkerPresent = Boolean(rows[0].workerToken);
      await tx.update(executions).set({ workerToken, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs), updatedAt: now }).where(eq(executions.id, executionId));
      acquired = true;
    });
    if (acquired) {
      await this.events.append(executionId, recovered ? 'worker_lease_recovered' : 'worker_lease_acquired', {
        workerId,
        recovered,
        previousWorkerPresent,
        leaseDurationMs: this.leaseDurationMs,
      });
      if (recovered) {
        const running = await this.db.select({ id: executionSteps.id }).from(executionSteps).where(and(eq(executionSteps.executionId, executionId), eq(executionSteps.status, 'running')));
        for (const step of running) await this.stepStates.transition(step.id, 'retry_wait', { errorCode: 'WORKER_LEASE_EXPIRED', errorMessage: 'Previous worker lease expired; resuming this step' });
      }
    }
    return { acquired, recovered, workerToken, workerId, previousWorkerPresent, status };
  }

  async heartbeat(executionId: string, workerToken: string) {
    const now = new Date();
    const [result] = await this.db.update(executions)
      .set({ heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs), updatedAt: now })
      .where(and(
        eq(executions.id, executionId),
        eq(executions.workerToken, workerToken),
      ));
    return result.affectedRows === 1;
  }
}
