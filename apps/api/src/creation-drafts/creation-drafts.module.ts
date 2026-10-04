import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { DraftGapProjectionService } from './draft-gap-projection.service';
import { FactDemandsModule } from '../fact-demands/fact-demands.module';
import { CreationDraftsController } from './creation-drafts.controller';
import { CreationDraftsService } from './creation-drafts.service';

@Module({
  imports: [FactDemandsModule, RuntimeCatalogModule],
  controllers: [CreationDraftsController],
  providers: [CreationDraftsService, DraftGapProjectionService],
  exports: [CreationDraftsService],
})
export class CreationDraftsModule {}
