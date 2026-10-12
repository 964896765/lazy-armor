import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryCandidatesService } from './memory-candidates.service';
import { MemoryGraphService } from './memory-graph.service';
import { LearningCandidatesService } from './learning-candidates.service';
import { ReportDecisionsService } from './report-decisions.service';
@Module({ imports: [AuditModule], controllers: [MemoryController], providers: [MemoryService, MemoryCandidatesService, MemoryGraphService, LearningCandidatesService, ReportDecisionsService], exports: [MemoryService, MemoryCandidatesService, MemoryGraphService, LearningCandidatesService, ReportDecisionsService] })
export class MemoryModule {}
