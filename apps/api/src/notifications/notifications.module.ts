import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPolicyService } from './notification-policy.service';
import { UsageModule } from '../usage/usage.module';

@Module({ imports: [UsageModule], controllers: [NotificationsController], providers: [NotificationPolicyService, NotificationService], exports: [NotificationPolicyService, NotificationService] })
export class NotificationsModule {}
