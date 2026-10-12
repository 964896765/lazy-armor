import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, DefaultValuePipe, BadRequestException } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { GoalExperienceService } from './goal-experience.service';

@Controller('consumer/goal-experience')
export class GoalExperienceController {
  constructor(private readonly experience: GoalExperienceService) {}
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    if (limit < 1 || limit > 20) throw new BadRequestException('每次读取 1–20 个目标');
    return this.experience.list(user.id, limit);
  }
  @Get(':conversationId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.experience.get(user.id, conversationId);
  }
}
