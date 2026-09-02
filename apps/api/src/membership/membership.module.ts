import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitlementService } from './entitlement.service';
import { MembershipController } from './membership.controller';
import { MembershipLifecycleService } from './membership-lifecycle.service';

@Module({
  imports: [AuditModule],
  controllers: [MembershipController],
  providers: [EntitlementService, MembershipLifecycleService],
  exports: [EntitlementService, MembershipLifecycleService],
})
export class MembershipModule {}
