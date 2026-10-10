import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../../common/auth-context';
import { CursorPageDto } from '../../common/cursor-pagination';
import { AgentLoopService } from './agent-loop.service';

class LoopPageDto extends CursorPageDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) override limit = 10; }
@Controller()
export class AgentLoopController {
  constructor(private readonly loops: AgentLoopService) {}
  @Get('agent/loops') list(@CurrentUser() user: AuthenticatedUser, @Query() query: LoopPageDto) { return this.loops.list(user.id, query); }
  @Get('plans/:id/agent-loop') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.loops.forPlan(user.id, id); }
  @Get('plans/:id/agent-loop/history') history(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: LoopPageDto) { return this.loops.history(user.id, id, query); }
}
