import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlanDefinitionAssembler } from './plan-definition.assembler';
import { PlanStateService } from './plan-state.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { LifecycleReadService } from './lifecycle-read.service';
import { MembershipModule } from '../membership/membership.module';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { PlanLifecycleProjectionService } from './plan-lifecycle-projection.service';
import { FactDemandsModule } from '../fact-demands/fact-demands.module';

export const PLAN_SERVICE = 'PLAN_SERVICE';

@Module({
  imports: [AuditModule, MembershipModule, RuntimeCatalogModule, FactDemandsModule],
  controllers: [PlansController],
  providers: [
    PlanDefinitionAssembler,
    PlanStateService,
    PlansService,
    LifecycleReadService,
    PlanLifecycleProjectionService,
    { provide: PLAN_SERVICE, useExisting: PlansService },
  ],
  exports: [PlansService, LifecycleReadService, PlanLifecycleProjectionService, PLAN_SERVICE, PlanDefinitionAssembler, PlanStateService],
})
export class PlansModule {}
