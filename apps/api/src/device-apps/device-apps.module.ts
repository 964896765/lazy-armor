import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceAppsController } from './device-apps.controller';
import { DeviceAppsService } from './device-apps.service';
import { MobileNotificationReceiptsService } from './mobile-notification-receipts.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [DeviceAppsController],
  providers: [DeviceAppsService, MobileNotificationReceiptsService],
  exports: [DeviceAppsService, MobileNotificationReceiptsService],
})
export class DeviceAppsModule {}
