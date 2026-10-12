import { Module } from '@nestjs/common';
import { AuthoringJobsService } from './authoring-jobs.service';
import { AuthoringJobsController } from './authoring-jobs.controller';
import { OrchestratorService } from './orchestrator.service';
import { RequirementsModule } from '../requirements/requirements.module';
import { AiAdapterModule } from '../ai-adapter/ai-adapter.module';

/** Proposal computation only; execution authorities remain in existing modules. */
@Module({ imports: [RequirementsModule, AiAdapterModule], controllers: [AuthoringJobsController], providers: [AuthoringJobsService, OrchestratorService], exports: [AuthoringJobsService, OrchestratorService] })
export class OrchestratorModule {}
