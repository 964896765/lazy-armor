import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MobileEvidenceService } from './mobile-evidence.service';
import { MobileObservationService } from './mobile-observation.service';
import { RealityPipelineService } from './reality-pipeline.service';
import { RealityPipelineController } from './reality-pipeline.controller';
import { StrategyRuntimeModule } from '../strategy-runtime/strategy-runtime.module';
import { VersionedResourceTruthService } from './versioned-resource-truth.service';

@Module({ imports: [AuditModule, StrategyRuntimeModule], controllers: [RealityPipelineController], providers: [RealityPipelineService, MobileObservationService, MobileEvidenceService, VersionedResourceTruthService], exports: [RealityPipelineService, MobileObservationService, MobileEvidenceService] })
export class RealityPipelineModule {}
