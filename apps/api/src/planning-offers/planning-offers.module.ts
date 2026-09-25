import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { FactDemandsModule } from '../fact-demands/fact-demands.module';
import { PlansModule } from '../plans/plans.module';
import { StrategyRuntimeModule } from '../strategy-runtime/strategy-runtime.module';
import { PlanningOffersController } from './planning-offers.controller';
import { PlanningOffersService } from './planning-offers.service';

@Module({
  imports: [RuntimeCatalogModule, FactDemandsModule, PlansModule, StrategyRuntimeModule],
  controllers: [PlanningOffersController],
  providers: [PlanningOffersService],
  exports: [PlanningOffersService],
})
export class PlanningOffersModule {}
