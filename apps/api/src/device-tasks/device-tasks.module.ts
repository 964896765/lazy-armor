import {CapabilityInvocationsModule} from '../capability-invocations/capability-invocations.module';
import {RuntimeTargetsModule} from '../runtime-targets/runtime-targets.module';
import {AcquisitionModule} from '../acquisition/acquisition.module';
import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';
import { StructuredReadModule } from '../structured-read/structured-read.module';
import { TrustedDevicesModule } from '../trusted-devices/trusted-devices.module';
import { DeviceTasksController } from './device-tasks.controller';
import { DeviceTasksService } from './device-tasks.service';

@Module({
  imports: [CapabilityInvocationsModule,RuntimeTargetsModule,AcquisitionModule,AuditModule, RealityPipelineModule, TrustedDevicesModule, forwardRef(() => StructuredReadModule)],
  controllers: [DeviceTasksController],
  providers: [DeviceTasksService],
  exports: [DeviceTasksService],
})
export class DeviceTasksModule {}
