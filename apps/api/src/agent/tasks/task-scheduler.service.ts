import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { agentTaskGraphs, executions, executionSteps, sideEffectOperations } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { QueueService } from '../../infrastructure/queue.service';
import { ExecutionPolicyService } from '../../execution/execution-policy.service';

export interface TaskScheduler { enqueueExecution(executionId: string): Promise<void> }

/** Execution-level admission; Runtime retains dependency order, leases and safe retries. */
@Injectable()
export class RuntimeTaskScheduler implements TaskScheduler {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly queue: QueueService, private readonly policy: ExecutionPolicyService) {}

  async enqueueExecution(executionId: string) {
    const execution = (await this.db.select().from(executions).where(eq(executions.id, executionId)))[0];
    if (!execution) throw new NotFoundException('Execution not found');
    const graph = (await this.db.select().from(agentTaskGraphs).where(eq(agentTaskGraphs.executionId, executionId)))[0];
    const steps = await this.db.select({ errorCode: executionSteps.errorCode }).from(executionSteps).where(eq(executionSteps.executionId, executionId));
    const operations = await this.db.select({ status: sideEffectOperations.status }).from(sideEffectOperations).where(eq(sideEffectOperations.executionId, executionId));
    if (graph?.status === 'UNKNOWN' || execution.errorCode === 'OUTCOME_UNKNOWN' || steps.some(step => step.errorCode === 'OUTCOME_UNKNOWN') || operations.some(operation => operation.status === 'outcome_unknown')) {
      throw new ConflictException('TASK_OUTCOME_UNKNOWN_REQUIRES_RECONCILIATION');
    }
    if (!['created', 'queued', 'retry_wait', 'waiting_dispatch', 'running'].includes(execution.status)) throw new ConflictException('TASK_EXECUTION_NOT_SCHEDULABLE');
    await this.queue.addExecution(executionId, this.policy.current);
  }
}
