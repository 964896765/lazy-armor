import { Module } from '@nestjs/common';
import { GoalUnderstandingService } from './planner/goal-understanding.service';
import { GoalExecutionContextService } from './goal-execution-context.service';

/** Agent Core derives proposals. Existing authorities own confirmation and execution. */
@Module({ providers: [GoalUnderstandingService, GoalExecutionContextService], exports: [GoalUnderstandingService, GoalExecutionContextService] })
export class AgentModule {}
