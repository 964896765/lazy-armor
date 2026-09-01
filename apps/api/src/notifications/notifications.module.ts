import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPolicyService } from './notification-policy.service';

@Module({ controllers: [NotificationsController], providers: [NotificationPolicyService, NotificationService], exports: [NotificationPolicyService, NotificationService] })
export class NotificationsModule {}
