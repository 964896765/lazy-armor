import { Module } from '@nestjs/common';
import { ScenarioCoverageLedgerController } from './scenario-coverage-ledger.controller';
import { ScenarioCoverageLedgerService } from './scenario-coverage-ledger.service';

@Module({
  controllers: [ScenarioCoverageLedgerController],
  providers: [ScenarioCoverageLedgerService],
  exports: [ScenarioCoverageLedgerService],
})
export class ScenarioCoverageLedgerModule {}
