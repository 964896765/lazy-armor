import { APPROVAL_POLICY_TYPES, type ApprovalPolicyType, type RiskLevel } from '@lazy-armor/plan-schema';

export { APPROVAL_POLICY_TYPES, type ApprovalPolicyType };

export const RISK_POLICY_VERSION = 'p0-6-risk-v1';
export const RISK_SCORE: Readonly<Record<RiskLevel, number>> = Object.freeze({ R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 });

export type SideEffectClass = 'read_only' | 'internal_record' | 'draft_preparation' | 'external_visible' | 'financial_account';
export type MinimumApprovalRequirement = 'none' | 'confirmation' | 'strong_confirmation';

export const SIDE_EFFECT_CLASS: Readonly<Record<RiskLevel, SideEffectClass>> = Object.freeze({
  R0: 'read_only', R1: 'internal_record', R2: 'draft_preparation', R3: 'external_visible', R4: 'financial_account',
});
export const MINIMUM_APPROVAL_REQUIREMENT: Readonly<Record<RiskLevel, MinimumApprovalRequirement>> = Object.freeze({
  R0: 'none', R1: 'none', R2: 'none', R3: 'confirmation', R4: 'strong_confirmation',
});

export interface ResolvedApprovalPolicy {
  version: 'p0-6-approval-v1';
  type: ApprovalPolicyType;
  config: Record<string, unknown>;
  systemFloor: 'R3';
}

export interface RiskSnapshot {
  policyVersion: typeof RISK_POLICY_VERSION;
  riskPolicyVersion: typeof RISK_POLICY_VERSION;
  actionType: string;
  registryRisk: RiskLevel;
  declaredRisk: RiskLevel;
  capabilityRisk: RiskLevel | null;
  dynamicRisk: RiskLevel;
  effectiveRisk: RiskLevel;
  resolvedRiskLevel: RiskLevel;
  riskReasonCodes: string[];
  sideEffectClass: SideEffectClass;
  minimumApprovalRequirement: MinimumApprovalRequirement;
  factors: string[];
  amountMinor: number | null;
  currency: string | null;
  inputFingerprint: string;
}

export function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_SCORE[left] >= RISK_SCORE[right] ? left : right;
}
