import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeviceAppsController } from './device-apps.controller';
import { DeviceAppsService } from './device-apps.service';

@Module({
  imports: [AuditModule],
  controllers: [DeviceAppsController],
  providers: [DeviceAppsService],
  exports: [DeviceAppsService],
})
export class DeviceAppsModule {}
