import { Module } from '@nestjs/common';
import { PlanIntentAdapterService } from './plan-intent-adapter.service';

// Adapter boundary only; AI is not part of execution or risk decisions.
@Module({
  providers: [PlanIntentAdapterService],
  exports: [PlanIntentAdapterService],
})
export class AiAdapterModule {}
