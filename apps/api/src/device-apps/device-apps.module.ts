import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrustedDevicesModule } from '../trusted-devices/trusted-devices.module';
import { TruthStoreModule } from '../truth-store/truth-store.module';
import { DeviceAppsController } from './device-apps.controller';
import { DeviceAppsService } from './device-apps.service';
import { MobileNotificationReceiptsService } from './mobile-notification-receipts.service';

@Module({
  imports: [AuditModule, NotificationsModule, TrustedDevicesModule, TruthStoreModule],
  controllers: [DeviceAppsController],
  providers: [DeviceAppsService, MobileNotificationReceiptsService],
  exports: [DeviceAppsService, MobileNotificationReceiptsService],
})
export class DeviceAppsModule {}
