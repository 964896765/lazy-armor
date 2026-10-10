import { Module } from '@nestjs/common';
import { SkillRegistryService } from './skill-registry.service';
import { AuditModule } from '../audit/audit.module';
import { SkillRepositoriesService } from './skill-repositories.service';
import { SkillRepositoriesController, PlanSkillReferencesController } from './skill-repositories.controller';
import { SkillPackageFetcher, SkillSourceService } from './skill-source.service';

@Module({ imports: [AuditModule], controllers: [SkillRepositoriesController, PlanSkillReferencesController], providers: [SkillRegistryService, SkillRepositoriesService, SkillPackageFetcher, SkillSourceService], exports: [SkillRegistryService, SkillRepositoriesService] })
export class PortableSkillsModule {}
