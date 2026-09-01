import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { executionSteps } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionEventService } from './execution-event.service';
import { STEP_TERMINAL_STATES, type ExecutionStepStatus } from './execution.types';

type StepExecutor = Pick<InjectedDatabase, 'select' | 'update' | 'insert'> & { transaction?: InjectedDatabase['transaction'] };

const TRANSITIONS: Readonly<Record<ExecutionStepStatus, readonly ExecutionStepStatus[]>> = Object.freeze({
  pending: ['running', 'waiting_dispatch', 'failed', 'skipped', 'cancelled'],
  running: ['succeeded', 'failed', 'retry_wait', 'waiting_dispatch', 'skipped', 'cancelled'],
  waiting_dispatch: ['running', 'succeeded', 'failed', 'skipped', 'cancelled'],
  retry_wait: ['running', 'failed', 'cancelled'],
  succeeded: [], failed: [], skipped: [], cancelled: [],
});

@Injectable()
export class ExecutionStepStateService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly events: ExecutionEventService) {}

  async transition(id: string, target: ExecutionStepStatus, patch: Partial<typeof executionSteps.$inferInsert> = {}, executor: StepExecutor = this.db) {
    let current: ExecutionStepStatus | undefined;
    let executionId: string | undefined;
    const body = async (client: NonNullable<StepExecutor>) => {
      const rows = await client.select({ executionId: executionSteps.executionId, status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.id, id)).limit(1).for('update');
      if (!rows[0]) throw new NotFoundException('ExecutionStep not found');
      executionId = rows[0].executionId;
      current = rows[0].status as ExecutionStepStatus;
      if (current === target) return;
      if (STEP_TERMINAL_STATES.has(current)) throw new ConflictException('Terminal ExecutionStep is immutable');
      if (!TRANSITIONS[current].includes(target)) throw new BadRequestException(`Illegal ExecutionStep state transition: ${current} -> ${target}`);
      await client.update(executionSteps).set({ ...patch, status: target, updatedAt: new Date() }).where(and(eq(executionSteps.id, id), eq(executionSteps.status, current)));
      await this.events.append(executionId!, 'step_state_changed', { from: current, to: target }, id, client);
    };
    if (executor.transaction) await executor.transaction(body);
    else await body(executor);
  }
}
