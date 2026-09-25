import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { PlanningOffersController } from './planning-offers.controller';
import { PlanningOffersService } from './planning-offers.service';

@Module({
  imports: [RuntimeCatalogModule],
  controllers: [PlanningOffersController],
  providers: [PlanningOffersService],
  exports: [PlanningOffersService],
})
export class PlanningOffersModule {}
