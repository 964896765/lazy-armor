import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../../common/auth-context';
import { CursorPageDto } from '../../common/cursor-pagination';
import { TaskGraphsService } from './task-graphs.service';

@Controller()
export class TaskGraphsController {
  constructor(private readonly tasks: TaskGraphsService) {}
  @Get('plans/:id/task-graphs') list(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: CursorPageDto) {
    return this.tasks.listForPlan(user.id, id, query);
  }
  @Get('task-graphs/:id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(user.id, id);
  }
}
