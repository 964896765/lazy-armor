import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { projectConsumerOutcome, type RuntimeResultState } from '@lazy-armor/plan-schema';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ListExecutionsDto, ListExecutionsPageDto, ManualExecutionDto, ResolvedExecutionDto } from './dto';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { ExecutionsService } from './executions.service';
import { ActionAdapter } from './action-adapter.service';
import { ReconciliationService } from './reconciliation.service';
import { LifecycleReadService } from '../plans/lifecycle-read.service';

@Controller()
export class ExecutionsController {
  constructor(private readonly dispatch: ExecutionDispatchService, private readonly executions: ExecutionsService, private readonly adapter: ActionAdapter, private readonly reconciliation: ReconciliationService, private readonly lifecycleRead: LifecycleReadService) {}

  @Post('plans/:id/executions') create(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ManualExecutionDto) { return this.dispatch.dispatchManual(user.id, id, input.requestId, input.triggerPayload); }
  @Post('plans/:id/resolved-executions') createResolved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ResolvedExecutionDto) { return this.dispatch.dispatchManual(user.id, id, input.requestId, input.triggerPayload, input.resolutionDecisionIds); }
  @Get('executions') async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExecutionsDto) {
    const rows = await this.executions.list(user.id, query);
    const unknown = await this.reconciliation.outcomeUnknownExecutionIds(user.id, rows.map((row) => row.id));
    return rows.map((row) => {
      const resultState = unknown.has(row.id) ? 'OUTCOME_UNKNOWN' : null;
      return { ...row, resultState, outcome: listOutcome(row.status, resultState) };
    });
  }
  @Get('executions/page') async listPage(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExecutionsPageDto) {
    const page = await this.executions.listPage(user.id, query);
    const unknown = await this.reconciliation.outcomeUnknownExecutionIds(user.id, page.items.map((row) => row.id));
    return { items: page.items.map((row) => {
      const resultState = unknown.has(row.id) ? 'OUTCOME_UNKNOWN' : null;
      return { ...row, resultState, outcome: listOutcome(row.status, resultState) };
    }), nextCursor: page.nextCursor };
  }
  @Get('executions/:id') async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const [detail, verification] = await Promise.all([this.executions.get(user.id, id), this.reconciliation.executionResult(user.id, id)]);
    return { ...detail, resultState: verification.resultState, reconciliationCases: verification.reconciliationCases,
      outcome: projectConsumerOutcome({
        executionStatus: detail.status,
        approvalStatus: detail.approvalStatus,
        resultState: verification.resultState,
        reconciliationOpen: verification.reconciliationCases.some((item) => item.status === 'OPEN' || item.status === 'RECONCILING'),
        reconciliationNeedsUser: verification.reconciliationCases.some((item) => item.status === 'NEEDS_USER'),
        completedSteps: verification.completedSteps,
        failedSteps: verification.failedSteps,
      }) };
  }
  @Get('executions/:id/lifecycle') lifecycle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.lifecycleRead.forExecution(user.id, id); }
  @Get('plans/:id/executions') listForPlan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.listForPlan(user.id, id); }
  @Post('executions/:id/cancel') cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.cancel(user.id, id); }
  @Get('action-intents/:id') getIntent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.adapter.get(user.id, id); }
  @Get('executions/:id/action-intents') listIntents(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.adapter.listForExecution(user.id, id); }
}

function listOutcome(status: string, resultState: string | null) {
  const folded: RuntimeResultState | null = resultState === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN'
    : status === 'succeeded' ? 'SUCCEEDED'
    : status === 'failed' ? 'FAILED'
    : status === 'partially_succeeded' ? 'PARTIALLY_SUCCEEDED'
    : null;
  return projectConsumerOutcome({
    executionStatus: status,
    approvalStatus: status === 'waiting_approval' ? 'pending' : null,
    resultState: folded,
    reconciliationOpen: resultState === 'OUTCOME_UNKNOWN',
    reconciliationNeedsUser: false,
  });
}
