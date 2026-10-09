import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { GoalUnderstandingService } from './planner/goal-understanding.service';
import { GoalExecutionContextService } from './goal-execution-context.service';

/** Agent Core derives proposals. Existing authorities own confirmation and execution. */
@Module({ imports: [MemoryModule], providers: [GoalUnderstandingService, GoalExecutionContextService], exports: [GoalUnderstandingService, GoalExecutionContextService] })
export class AgentModule {}
