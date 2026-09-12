import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { VerificationPolicyRegistry } from './verification-policy-registry.service';
import { ReconciliationService } from './reconciliation.service';
@Controller()
export class VerificationController {
  constructor(private readonly policies: VerificationPolicyRegistry, private readonly reconciliation: ReconciliationService) {}
  @Get('verification-policies') listPolicies() { return this.policies.list(); }
  @Get('reconciliation-cases') list(@CurrentUser() user: AuthenticatedUser) { return this.reconciliation.list(user.id); }
  @Get('reconciliation-cases/:id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.reconciliation.get(user.id, id); }
  @Post('reconciliation-cases/:id/recheck') recheck(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.reconciliation.requestRecheck(user.id, id); }
  @Get('executions/:id/verification') result(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.reconciliation.executionResult(user.id, id); }
}
