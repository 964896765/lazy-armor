import { Module } from '@nestjs/common';
import { AiAdapterModule } from '../ai-adapter/ai-adapter.module';
import { PlansModule } from '../plans/plans.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [PlansModule, AiAdapterModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
