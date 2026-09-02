import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlanDefinitionAssembler } from './plan-definition.assembler';
import { PlanStateService } from './plan-state.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { MembershipModule } from '../membership/membership.module';

export const PLAN_SERVICE = 'PLAN_SERVICE';

@Module({
  imports: [AuditModule, MembershipModule],
  controllers: [PlansController],
  providers: [
    PlanDefinitionAssembler,
    PlanStateService,
    PlansService,
    { provide: PLAN_SERVICE, useExisting: PlansService },
  ],
  exports: [PlansService, PLAN_SERVICE, PlanDefinitionAssembler, PlanStateService],
})
export class PlansModule {}
