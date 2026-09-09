import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RealityPipelineService } from './reality-pipeline.service';
import { RealityPipelineController } from './reality-pipeline.controller';

@Module({ imports: [AuditModule], controllers: [RealityPipelineController], providers: [RealityPipelineService], exports: [RealityPipelineService] })
export class RealityPipelineModule {}
