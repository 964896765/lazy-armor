import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { UsageService } from './usage.service';
import { CursorPageDto } from '../common/cursor-pagination';

@Controller('me/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  getMonthlyUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.usage.getMonthlyUsage(user.id);
  }

  @Get('events')
  listEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.usage.listEvents(user.id, query);
  }
}
