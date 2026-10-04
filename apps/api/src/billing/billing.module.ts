import { Module } from '@nestjs/common';
import { ArtifactModule } from '../artifacts/artifact.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FileImportService } from './file-import.service';
import { AuditModule } from '../audit/audit.module';
import { FileImportController } from './file-import.controller';
import { UsageModule } from '../usage/usage.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';

@Module({
  imports: [ArtifactModule, AuditModule, UsageModule, RealityPipelineModule],
  controllers: [BillingController, FileImportController],
  providers: [BillingService, FileImportService],
  exports: [BillingService, FileImportService],
})
export class BillingModule {}
