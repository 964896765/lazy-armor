import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, Roles, type AuthenticatedUser } from '../common/auth-context';
import { CostService } from './cost.service';
import { SetCostBudgetDto } from './dto';

@Controller('costs')
export class CostController {
  constructor(private readonly costs: CostService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) { return this.costs.summary(user.id); }

  @Roles('super_admin')
  @Post('admin/budgets')
  setBudget(@CurrentUser() user: AuthenticatedUser, @Body() input: SetCostBudgetDto) {
    return this.costs.setBudget(user.id, input);
  }
}
