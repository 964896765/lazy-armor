import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../common/database.module';
import { TrustedDevicesController } from './trusted-devices.controller';
import { TrustedDevicesService } from './trusted-devices.service';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [TrustedDevicesController],
  providers: [TrustedDevicesService],
  exports: [TrustedDevicesService],
})
export class TrustedDevicesModule {}
