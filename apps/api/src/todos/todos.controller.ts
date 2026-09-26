import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TodosService } from './todos.service';

@Controller()
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get('todos')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.todos.list(user.id);
  }
}
