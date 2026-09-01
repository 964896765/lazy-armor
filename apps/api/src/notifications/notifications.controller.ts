import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { NotificationService, type NotificationPriority } from './notification.service';

@Controller()
export class NotificationsController {
  constructor(private readonly service: NotificationService) {}
  @Get('notifications') list(@CurrentUser() user: AuthenticatedUser, @Query('priority') priority?: NotificationPriority, @Query('unread') unread?: string) { return this.service.list(user.id, priority, unread === 'true'); }
  @Get('notifications/unread-count') unreadCount(@CurrentUser() user: AuthenticatedUser) { return this.service.unreadCount(user.id); }
  @Post('notifications/:id/read') read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.markRead(user.id, id); }
  @Post('notifications/:id/archive') archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.archive(user.id, id); }
  @Get('today') today(@CurrentUser() user: AuthenticatedUser) { return this.service.today(user.id); }
}
