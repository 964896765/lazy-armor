import {AcquisitionModule} from '../acquisition/acquisition.module';
import { AuditModule } from '../audit/audit.module';
import {DeviceTasksModule} from '../device-tasks/device-tasks.module';
import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { FactDemandResolverService } from './fact-demand-resolver.service';
import { FactDemandsController } from './fact-demands.controller';

@Module({
  imports: [RuntimeCatalogModule,DeviceTasksModule,AcquisitionModule,AuditModule],
  controllers: [FactDemandsController],
  providers: [FactDemandResolverService],
  exports: [FactDemandResolverService],
})
export class FactDemandsModule {}
