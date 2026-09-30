import { Module } from '@nestjs/common';
import { FactDemandsModule } from '../fact-demands/fact-demands.module';
import { CreationDraftsController } from './creation-drafts.controller';
import { CreationDraftsService } from './creation-drafts.service';

@Module({
  imports: [FactDemandsModule],
  controllers: [CreationDraftsController],
  providers: [CreationDraftsService],
  exports: [CreationDraftsService],
})
export class CreationDraftsModule {}
