import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryCandidatesService } from './memory-candidates.service';
import { MemoryGraphService } from './memory-graph.service';
@Module({ imports: [AuditModule], controllers: [MemoryController], providers: [MemoryService, MemoryCandidatesService, MemoryGraphService], exports: [MemoryService, MemoryCandidatesService, MemoryGraphService] })
export class MemoryModule {}
