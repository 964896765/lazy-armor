import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { connectorCapabilities } from '@lazy-armor/database';
import { ACTION_DEFINITIONS, canonicalStringify, type NormalizedAction, type RiskLevel } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { higherRisk, MINIMUM_APPROVAL_REQUIREMENT, RISK_POLICY_VERSION, SIDE_EFFECT_CLASS, type RiskSnapshot } from './risk.types';

type RiskExecutor = Pick<InjectedDatabase, 'select'>;

// 金额只接受十进制字符串或非负有限 number，并以字符串解析为最小货币单位整数；
// 全程不做 float 金额运算（金额比较一律在 minor units 整数上进行）。
export function parseAmountToMinor(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(minor) && minor <= 2_000_000_000 ? minor : null;
}

@Injectable()
export class RiskEngine {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async evaluate(action: NormalizedAction, declaredRisk: RiskLevel, input: Record<string, unknown>, connectorId: string | null, executor: RiskExecutor = this.db): Promise<RiskSnapshot> {
    const definition = ACTION_DEFINITIONS[action.actionType];
    const registryRisk = definition.riskLevel;
    const capabilityRisk = connectorId && action.requiredCapability
      ? (await executor.select({ riskLevel: connectorCapabilities.riskLevel }).from(connectorCapabilities)
        .where(and(eq(connectorCapabilities.connectorId, connectorId), eq(connectorCapabilities.key, action.requiredCapability))).limit(1))[0]?.riskLevel as RiskLevel | undefined
      : undefined;
    const factors: string[] = [];
    let dynamicRisk: RiskLevel = 'R0';
    const combined = { ...input, ...action.config } as Record<string, unknown>;
    // 金额字段只能来自 ActionDefinition 的显式声明，禁止扫描任意 JSON。
    const amountMinor = definition.amountField ? parseAmountToMinor(input[definition.amountField] ?? action.config[definition.amountField]) : null;
    const rawCurrency = definition.currencyField ? (input[definition.currencyField] ?? action.config[definition.currencyField] ?? combined.currency) : null;
    const currency = typeof rawCurrency === 'string' && /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : amountMinor === null ? null : 'CNY';
    if (combined.sensitiveData === true || combined.changesAccountPermissions === true) { dynamicRisk = 'R4'; factors.push('sensitive_or_account_permission'); }
    if (combined.visibility === 'public') { dynamicRisk = higherRisk(dynamicRisk, 'R3'); factors.push('public_visibility'); }
    if (combined.irreversible === true) { dynamicRisk = higherRisk(dynamicRisk, 'R3'); factors.push('irreversible'); }
    if (typeof combined.batchSize === 'number' && combined.batchSize >= 100) { dynamicRisk = higherRisk(dynamicRisk, 'R3'); factors.push('large_batch'); }
    if (amountMinor !== null && definition.amountField) {
      dynamicRisk = higherRisk(dynamicRisk, amountMinor >= 1_000_000 ? 'R4' : 'R3');
      factors.push(amountMinor >= 1_000_000 ? 'high_amount' : 'monetary_action');
    }
    let effectiveRisk = higherRisk(registryRisk, declaredRisk);
    if (capabilityRisk) effectiveRisk = higherRisk(effectiveRisk, capabilityRisk);
    effectiveRisk = higherRisk(effectiveRisk, dynamicRisk);
    const fingerprintPayload = { actionType: action.actionType, stepOrder: action.stepOrder, connectionId: action.connectionId, requiredCapability: action.requiredCapability, config: action.config, input };
    const inputFingerprint = createHash('sha256').update(canonicalStringify(fingerprintPayload)).digest('hex');
    return {
      policyVersion: RISK_POLICY_VERSION, riskPolicyVersion: RISK_POLICY_VERSION, actionType: action.actionType,
      registryRisk, declaredRisk, capabilityRisk: capabilityRisk ?? null, dynamicRisk, effectiveRisk,
      resolvedRiskLevel: effectiveRisk, riskReasonCodes: factors,
      sideEffectClass: SIDE_EFFECT_CLASS[effectiveRisk], minimumApprovalRequirement: MINIMUM_APPROVAL_REQUIREMENT[effectiveRisk],
      factors, amountMinor, currency, inputFingerprint,
    };
  }
}
