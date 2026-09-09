import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RealityPipelineService } from './reality-pipeline.service';
import { RealityPipelineController } from './reality-pipeline.controller';
import { StrategyRuntimeModule } from '../strategy-runtime/strategy-runtime.module';

@Module({ imports: [AuditModule, StrategyRuntimeModule], controllers: [RealityPipelineController], providers: [RealityPipelineService], exports: [RealityPipelineService] })
export class RealityPipelineModule {}
