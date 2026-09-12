import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ListExecutionsDto, ListExecutionsPageDto, ManualExecutionDto, ResolvedExecutionDto } from './dto';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { ExecutionsService } from './executions.service';
import { ActionAdapter } from './action-adapter.service';
import { ReconciliationService } from './reconciliation.service';

@Controller()
export class ExecutionsController {
  constructor(private readonly dispatch: ExecutionDispatchService, private readonly executions: ExecutionsService, private readonly adapter: ActionAdapter, private readonly reconciliation: ReconciliationService) {}

  @Post('plans/:id/executions') create(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ManualExecutionDto) { return this.dispatch.dispatchManual(user.id, id, input.requestId, input.triggerPayload); }
  @Post('plans/:id/resolved-executions') createResolved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ResolvedExecutionDto) { return this.dispatch.dispatchManual(user.id, id, input.requestId, input.triggerPayload, input.resolutionDecisionIds); }
  @Get('executions') list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExecutionsDto) { return this.executions.list(user.id, query); }
  @Get('executions/page') listPage(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExecutionsPageDto) { return this.executions.listPage(user.id, query); }
  @Get('executions/:id') async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const [detail, verification] = await Promise.all([this.executions.get(user.id, id), this.reconciliation.executionResult(user.id, id)]);
    return { ...detail, resultState: verification.resultState, reconciliationCases: verification.reconciliationCases };
  }
  @Get('plans/:id/executions') listForPlan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.listForPlan(user.id, id); }
  @Post('executions/:id/cancel') cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.cancel(user.id, id); }
  @Get('action-intents/:id') getIntent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.adapter.get(user.id, id); }
  @Get('executions/:id/action-intents') listIntents(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.adapter.listForExecution(user.id, id); }
}
