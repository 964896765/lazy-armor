import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { BindStrategyRuntimeDto, DependencyQueryDto } from './dto';
import { StrategyRuntimeService } from './strategy-runtime.service';

@Controller('strategy-runtime')
export class StrategyRuntimeController {
  constructor(private readonly runtime: StrategyRuntimeService) {}

  @Get('operators') operators() { return this.runtime.operators(); }
  @Post('bindings') bind(@CurrentUser() user: AuthenticatedUser, @Body() input: BindStrategyRuntimeDto) { return this.runtime.bind(user.id, input); }
  @Get('dependencies') dependencies(@CurrentUser() user: AuthenticatedUser, @Query() query: DependencyQueryDto) { return this.runtime.listDependencies(user.id, query); }
  @Get('wakeups') wakeups(@CurrentUser() user: AuthenticatedUser) { return this.runtime.listWakeups(user.id); }
  @Post('wakeups/:id/evaluate') evaluate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.runtime.evaluateWakeup(user.id, id); }
}
