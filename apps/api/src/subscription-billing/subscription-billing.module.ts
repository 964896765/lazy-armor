import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MembershipModule } from '../membership/membership.module';
import { SandboxSubscriptionBillingProvider } from './sandbox-subscription-billing.provider';
import { SubscriptionBillingController } from './subscription-billing.controller';
import { SubscriptionBillingProvider } from './subscription-billing.provider';
import { SubscriptionBillingService } from './subscription-billing.service';

@Module({
  imports: [AuditModule, MembershipModule],
  controllers: [SubscriptionBillingController],
  providers: [
    SandboxSubscriptionBillingProvider,
    { provide: SubscriptionBillingProvider, useExisting: SandboxSubscriptionBillingProvider },
    SubscriptionBillingService,
  ],
  exports: [SubscriptionBillingService, SubscriptionBillingProvider],
})
export class SubscriptionBillingModule {}
