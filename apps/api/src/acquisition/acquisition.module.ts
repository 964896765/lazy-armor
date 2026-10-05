import {RealityPipelineModule} from '../reality-pipeline/reality-pipeline.module';
import {Module} from '@nestjs/common';
import {AuditModule} from '../audit/audit.module';
import {LocalAcquisitionService} from '../consumer/local-acquisition.service';
@Module({imports:[AuditModule,RealityPipelineModule],providers:[LocalAcquisitionService],exports:[LocalAcquisitionService]})
export class AcquisitionModule {}
