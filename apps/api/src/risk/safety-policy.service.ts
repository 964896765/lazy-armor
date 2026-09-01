import { Inject, Injectable } from '@nestjs/common';
import { approvalRequests } from '@lazy-armor/database';
import type { ApprovalPolicyDefinition, ApprovalPolicyType, RiskLevel } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RISK_SCORE, type ResolvedApprovalPolicy } from './risk.types';

@Injectable()
export class SafetyPolicyService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  // ApprovalPolicy 的唯一来源是 PlanVersion 的正式 Definition（approval_policy_json，随 definitionHash 固化）。
  // 修改策略 = 创建新 PlanVersion → Apply；旧 Execution 永远使用创建时的 resolvedApprovalPolicyJson 快照。
  resolveFromDefinition(definition: ApprovalPolicyDefinition | undefined): ResolvedApprovalPolicy {
    return { version: 'p0-6-approval-v1', type: (definition?.type ?? 'never') as ApprovalPolicyType, config: (definition?.config ?? {}) as Record<string, unknown>, systemFloor: 'R3' };
  }

  async requiresApproval(userId: string, planActionId: string, risk: RiskLevel, amountMinor: number | null, currency: string | null, policy: ResolvedApprovalPolicy, temporaryAuthorizationMatched: boolean) {
    const authorized = risk !== 'R4' && policy.type === 'temporary_authorization' && temporaryAuthorizationMatched;
    const systemRequires = RISK_SCORE[risk] >= RISK_SCORE[policy.systemFloor] && !authorized;
    let policyRequires = false;
    if (policy.type === 'always' || policy.type === 'per_execution') policyRequires = true;
    if (policy.type === 'temporary_authorization' && !authorized) policyRequires = true;
    if (policy.type === 'first_time') {
      const prior = await this.db.select({ id: approvalRequests.id }).from(approvalRequests)
        .where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.planActionId, planActionId), eq(approvalRequests.status, 'approved'))).limit(1);
      policyRequires = prior.length === 0;
    }
    if (policy.type === 'above_risk_level') policyRequires = RISK_SCORE[risk] > RISK_SCORE[(policy.config.riskLevel as RiskLevel) ?? 'R0'];
    if (policy.type === 'above_amount') {
      const threshold = typeof policy.config.amountMinor === 'number' ? policy.config.amountMinor : Number.POSITIVE_INFINITY;
      const expectedCurrency = typeof policy.config.currency === 'string' ? policy.config.currency.toUpperCase() : currency;
      policyRequires = amountMinor !== null && currency === expectedCurrency && amountMinor > threshold;
    }
    return { required: systemRequires || policyRequires, reasons: [systemRequires ? 'system_risk_floor' : null, policyRequires ? `user_policy:${policy.type}` : null].filter(Boolean) as string[] };
  }
}
