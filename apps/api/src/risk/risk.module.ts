import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RiskEngine } from './risk-engine.service';
import { SafetyPolicyService } from './safety-policy.service';
import { TemporaryAuthorizationService } from '../approvals/temporary-authorization.service';

@Module({ imports: [AuditModule], providers: [RiskEngine, SafetyPolicyService, TemporaryAuthorizationService], exports: [RiskEngine, SafetyPolicyService, TemporaryAuthorizationService] })
export class RiskModule {}
