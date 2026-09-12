import { createHash } from 'node:crypto';
import { canonicalStringify, type RiskLevel } from './index';

export const ACTION_INTENT_SCHEMA_VERSION = '1' as const;
export const ACTION_ADAPTER_REVISION = 1 as const;
const RISK_SCORE: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export interface ContextRiskSignal {
  code: 'SENSITIVE_DATA' | 'ACCOUNT_PERMISSION_CHANGE' | 'PUBLIC_VISIBILITY' | 'IRREVERSIBLE' | 'LARGE_BATCH' | 'MONETARY_ACTION' | 'HIGH_AMOUNT';
  floor: RiskLevel;
}

export interface ActionIntentInput {
  intentId: string;
  planVersionId: string;
  planActionId: string;
  actionType: string;
  capabilityKey: string | null;
  resourceType: string;
  target: unknown;
  payload: unknown;
  desiredOutcome: string;
  sideEffectKey: string | null;
  providerRiskFloor: RiskLevel;
  scenarioRiskFloor: RiskLevel;
  actionRisk: RiskLevel;
  contextSignals: ContextRiskSignal[];
}

export interface ActionIntent extends ActionIntentInput {
  schemaVersion: typeof ACTION_INTENT_SCHEMA_VERSION;
  payloadHash: string;
  contextRiskElevation: RiskLevel;
  effectiveRisk: RiskLevel;
  intentHash: string;
}

export interface ApprovalSnapshot {
  schemaVersion: '1';
  executionId: string;
  executionStepId: string;
  planVersionId: string;
  planActionId: string;
  actionIntentId: string | null;
  actionIntentHash: string | null;
  capabilityKey: string | null;
  connectorId: string | null;
  connectionId: string | null;
  inputFingerprint: string;
  effectiveRisk: RiskLevel;
  amountMinor: number | null;
  currency: string | null;
  sideEffectKey: string | null;
  expiresAt: string;
}

export function riskMaximum(...levels: RiskLevel[]): RiskLevel {
  if (levels.some((level) => !Object.hasOwn(RISK_SCORE, level))) throw new Error('Invalid risk floor');
  return levels.reduce((highest, level) => RISK_SCORE[level] > RISK_SCORE[highest] ? level : highest, 'R0');
}

export function buildActionIntent(input: ActionIntentInput): ActionIntent {
  const payloadHash = hash(input.payload);
  const contextRiskElevation = riskMaximum(...input.contextSignals.map((signal) => signal.floor));
  const effectiveRisk = riskMaximum(input.providerRiskFloor, input.scenarioRiskFloor, input.actionRisk, contextRiskElevation);
  const { intentId, planVersionId, planActionId, actionType, capabilityKey, resourceType, target, payload, desiredOutcome,
    sideEffectKey, providerRiskFloor, scenarioRiskFloor, actionRisk, contextSignals } = input;
  const base = { schemaVersion: ACTION_INTENT_SCHEMA_VERSION, intentId, planVersionId, planActionId, actionType, capabilityKey,
    resourceType, target, payload, desiredOutcome, sideEffectKey, providerRiskFloor, scenarioRiskFloor, actionRisk, contextSignals,
    payloadHash, contextRiskElevation, effectiveRisk };
  return { ...base, intentHash: hash(base) };
}

export function approvalSnapshotHash(snapshot: ApprovalSnapshot): string { return hash(snapshot); }

export function approvalSnapshotInvalidation(snapshot: ApprovalSnapshot, current: ApprovalSnapshot, now: string): string[] {
  const reasons: string[] = [];
  if (![now, snapshot.expiresAt, current.expiresAt].every((value) => Number.isFinite(Date.parse(value)))) return ['APPROVAL_TIME_INVALID'];
  if (Date.parse(now) >= Date.parse(snapshot.expiresAt)) reasons.push('APPROVAL_EXPIRED');
  for (const key of ['schemaVersion', 'expiresAt', 'executionId', 'executionStepId', 'planVersionId', 'planActionId', 'actionIntentId', 'actionIntentHash', 'capabilityKey', 'connectorId', 'connectionId', 'inputFingerprint', 'effectiveRisk', 'amountMinor', 'currency', 'sideEffectKey'] as const) {
    if (canonicalStringify(snapshot[key]) !== canonicalStringify(current[key])) reasons.push(`${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_CHANGED`);
  }
  return reasons;
}

function hash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
