import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { FactDemandResolverService } from './fact-demand-resolver.service';
import { FactDemandsController } from './fact-demands.controller';

@Module({
  imports: [RuntimeCatalogModule],
  controllers: [FactDemandsController],
  providers: [FactDemandResolverService],
  exports: [FactDemandResolverService],
})
export class FactDemandsModule {}
