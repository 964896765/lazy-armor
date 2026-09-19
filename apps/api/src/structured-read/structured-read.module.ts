import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConnectionsModule } from '../connections/connections.module';
import { DeviceTasksModule } from '../device-tasks/device-tasks.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';
import { LocalFileStructuredReadService, NoopPdfTextLayer, PDF_TEXT_LAYER } from './file-structured-reader';
import { ReadEvidenceService } from './read-evidence.service';
import { StructuredReadController } from './structured-read.controller';
import { StructuredReadService } from './structured-read.service';
import { FixtureVisionAdapter, VISION_READ_ADAPTER } from './vision-adapter';

@Module({
  imports: [AuditModule, RealityPipelineModule, ConnectionsModule, forwardRef(() => DeviceTasksModule)],
  controllers: [StructuredReadController],
  providers: [
    StructuredReadService,
    ReadEvidenceService,
    LocalFileStructuredReadService,
    { provide: PDF_TEXT_LAYER, useClass: NoopPdfTextLayer },
    { provide: VISION_READ_ADAPTER, useClass: FixtureVisionAdapter },
  ],
  exports: [StructuredReadService, ReadEvidenceService],
})
export class StructuredReadModule {}
