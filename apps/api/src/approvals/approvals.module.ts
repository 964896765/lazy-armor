import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExecutionModule } from '../execution/execution.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RiskModule } from '../risk/risk.module';
import { PlansModule } from '../plans/plans.module';
import { ApprovalExpiryService } from './approval-expiry.service';
import { ApprovalService } from './approval.service';
import { ApprovalsController } from './approvals.controller';
import { TemporaryAuthorizationService } from './temporary-authorization.service';

export const APPROVAL_SERVICE = 'APPROVAL_SERVICE';

@Module({ imports: [ExecutionModule, RiskModule, NotificationsModule, PlansModule, AuditModule], controllers: [ApprovalsController], providers: [ApprovalService, ApprovalExpiryService, TemporaryAuthorizationService, { provide: APPROVAL_SERVICE, useExisting: ApprovalService }], exports: [ApprovalService, APPROVAL_SERVICE] })
export class ApprovalsModule {}
