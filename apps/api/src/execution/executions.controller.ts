import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ListExecutionsDto, ManualExecutionDto } from './dto';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { ExecutionsService } from './executions.service';

@Controller()
export class ExecutionsController {
  constructor(private readonly dispatch: ExecutionDispatchService, private readonly executions: ExecutionsService) {}

  @Post('plans/:id/executions') create(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ManualExecutionDto) { return this.dispatch.dispatchManual(user.id, id, input.requestId, input.triggerPayload); }
  @Get('executions') list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListExecutionsDto) { return this.executions.list(user.id, query); }
  @Get('executions/:id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.get(user.id, id); }
  @Get('plans/:id/executions') listForPlan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.listForPlan(user.id, id); }
  @Post('executions/:id/cancel') cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.executions.cancel(user.id, id); }
}
