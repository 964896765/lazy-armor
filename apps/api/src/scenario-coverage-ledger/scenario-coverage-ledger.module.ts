import { Module } from '@nestjs/common';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { ScenarioCoverageLedgerController } from './scenario-coverage-ledger.controller';
import { ScenarioCoverageLedgerService } from './scenario-coverage-ledger.service';

@Module({
  imports: [RuntimeCatalogModule],
  controllers: [ScenarioCoverageLedgerController],
  providers: [ScenarioCoverageLedgerService],
  exports: [ScenarioCoverageLedgerService],
})
export class ScenarioCoverageLedgerModule {}
