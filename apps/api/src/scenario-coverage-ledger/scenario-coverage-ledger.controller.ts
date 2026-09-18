import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ScenarioCoverageLedgerService } from './scenario-coverage-ledger.service';

@Controller('scenario-coverage-ledger')
export class ScenarioCoverageLedgerController {
  constructor(private readonly ledger: ScenarioCoverageLedgerService) {}

  @Get()
  list(@CurrentUser() _user: AuthenticatedUser) { return this.ledger.list(); }

  @Get('summary')
  summary(@CurrentUser() _user: AuthenticatedUser) { return this.ledger.summary(); }

  @Get('batch-10/wave-1')
  batch10Wave1(@CurrentUser() _user: AuthenticatedUser) { return this.ledger.batch10Wave1(); }

  @Get(':scenarioKey')
  get(@CurrentUser() _user: AuthenticatedUser, @Param('scenarioKey') scenarioKey: string) { return this.ledger.get(scenarioKey); }
}
