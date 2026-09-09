import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';
import { TrustedDevicesModule } from '../trusted-devices/trusted-devices.module';
import { AppReadSessionsController } from './app-read-sessions.controller';
import { AppReadSessionsService } from './app-read-sessions.service';

@Module({
  imports: [AuditModule, RealityPipelineModule, TrustedDevicesModule],
  controllers: [AppReadSessionsController],
  providers: [AppReadSessionsService],
  exports: [AppReadSessionsService],
})
export class AppReadSessionsModule {}
