import { Module } from '@nestjs/common';
import { AiAdapterModule } from '../ai-adapter/ai-adapter.module';
import { PlansModule } from '../plans/plans.module';
import { ChatController, PlanTemplatesController, TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { UsageModule } from '../usage/usage.module';
import { AuditModule } from '../audit/audit.module';
import { TemplateLifecycleService } from './template-lifecycle.service';

@Module({
  imports: [PlansModule, AiAdapterModule, UsageModule, AuditModule],
  controllers: [TemplatesController, PlanTemplatesController, ChatController],
  providers: [TemplatesService, TemplateLifecycleService],
  exports: [TemplatesService, TemplateLifecycleService],
})
export class TemplatesModule {}
