import { Controller, Inject, Injectable, OnApplicationShutdown, OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { plans, planVersions, strategyRuntimeWakeups } from '@lazy-armor/database';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { workerEnabled } from '../common/app-role';
import { ExecutionDispatchService } from '../execution/execution-dispatch.service';
import { StrategyRuntimeService } from './strategy-runtime.service';

@Injectable()
export class TerminalHandoffService implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly strategy: StrategyRuntimeService,
    private readonly dispatch: ExecutionDispatchService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 1000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
  async handoff(userId: string, wakeupId: string) {
    const row = (await this.db.select({ wakeup: strategyRuntimeWakeups, planId: plans.id }).from(strategyRuntimeWakeups)
      .innerJoin(planVersions, eq(planVersions.id, strategyRuntimeWakeups.planVersionId)).innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId))).limit(1))[0];
    // evaluateWakeup enforces ownership and returns the original immutable Decision on replay.
    let decision;
    try { decision = await this.strategy.evaluateWakeup(userId, wakeupId); }
    catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status && status >= 400 && status < 500) await this.db.update(strategyRuntimeWakeups)
        .set({ handoffStatus: 'BLOCKED', handoffReason: 'STRATEGY_EVALUATION_BLOCKED' })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      throw error;
    }
    if (!row || !row.wakeup.handoffStatus) return { decision, status: 'NOT_ELIGIBLE', executionId: null };
    if (decision.result !== 'READY_FOR_PLAN_ENGINE') {
      await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'QUIET', handoffReason: 'CONDITION_FALSE' })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      return { decision, status: 'QUIET', executionId: null };
    }
    try {
      const execution = await this.dispatch.dispatchStrategy(userId, row.planId, wakeupId);
      await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'DISPATCHED', handoffExecutionId: execution.id, handoffReason: null })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      return { decision, status: 'DISPATCHED', executionId: execution.id, executionStatus: execution.status };
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 403 || status === 409) {
        await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'BLOCKED', handoffReason: 'TERMINAL_HANDOFF_NOT_AUTHORIZED' })
          .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      }
      throw error;
    }
  }
  async tick(userId?: string) {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.db.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.handoffStatus, 'PENDING'),
        ...(userId ? [eq(strategyRuntimeWakeups.userId, userId)] : []))).orderBy(asc(strategyRuntimeWakeups.createdAt)).limit(4);
      // No exclusive worker lease is necessary: the existing Execution unique requestId is the durable claim.
      // A crash after dispatch leaves PENDING; a restart replays that same Execution, never sends again.
      await Promise.all(rows.map((row) => this.handoff(row.userId, row.id).catch(() => undefined)));
    } finally { this.running = false; }
  }
}

@Controller('strategy-runtime')
export class TerminalHandoffController {
  constructor(private readonly handoffService: TerminalHandoffService) {}
  @Post('wakeups/:id/handoff') handoff(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.handoffService.handoff(user.id, id);
  }
}
