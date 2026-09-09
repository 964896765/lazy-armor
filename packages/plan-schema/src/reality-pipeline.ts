import { createHash } from 'node:crypto';
import { canonicalStringify, type JsonValue } from './index';

export const SOURCE_MODES = ['OFFICIAL_API', 'WEBHOOK', 'NOTIFICATION', 'SHARE', 'FILE', 'MANUAL', 'INTERNAL'] as const;
export const PARSER_KEYS = ['generic.transaction.v1', 'generic.shipment-status.v1', 'generic.connection-health.v1', 'mobile-notification-billing.v1'] as const;
export type SourceMode = typeof SOURCE_MODES[number];
export type ParserKey = typeof PARSER_KEYS[number];

export const REALITY_ADAPTER_REGISTRY = Object.freeze([
  ...PARSER_KEYS.map((key) => Object.freeze({ key, kind: 'PARSER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
  ...['money.v1', 'shipment-status.v1', 'connection-health.v1'].map((key) => Object.freeze({ key, kind: 'NORMALIZER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
]);

export interface SourceObservationInput {
  sourceMode: SourceMode; providerKey: string; connectionId?: string | null;
  externalEventKey: string; parserKey: ParserKey; resourceHint: string;
  payload: Record<string, JsonValue>; evidenceHash: string;
  observedAt: string; occurredAt?: string | null;
}

export interface NormalizedFactDraft {
  resourceType: 'finance.transaction' | 'shipment' | 'digital_account.connection';
  resourceKey: string; subjectKey: string; factKey: 'finance.transaction.amount' | 'shipment.status' | 'digital_account.connection.health';
  value: Record<string, JsonValue>; confidence: number; normalizerKey: string;
  freshnessPolicyKey: 'transaction.default' | 'shipment.status' | 'connection.health';
  conflictPolicyKey: 'latest_verified_then_observed';
  compatibilityResourceKey?: string;
}

export interface RealityPolicyDefinition {
  key: string; revision: 1; kind: 'DEDUPE' | 'FRESHNESS' | 'CONFLICT'; definition: Record<string, JsonValue>;
}

const policy = (key: string, kind: RealityPolicyDefinition['kind'], definition: Record<string, JsonValue>): RealityPolicyDefinition => ({ key, revision: 1, kind, definition });
export const REALITY_POLICY_REGISTRY: readonly RealityPolicyDefinition[] = Object.freeze([
  policy('semantic-identity.v1', 'DEDUPE', { fields: ['userId', 'resourceType', 'resourceKey', 'subjectKey', 'factKey', 'valueHash'] }),
  policy('transaction.default', 'FRESHNESS', { ttlSeconds: 31536000, onStale: 'retain_historical' }),
  policy('shipment.status', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('connection.health', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('latest_verified_then_observed', 'CONFLICT', { order: ['verificationLevel', 'occurredAt', 'observedAt'], unresolved: 'block' }),
]);

const requireString = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (typeof value !== 'string' || !value) throw new Error(`Parser requires ${key}`); return value;
};
const requireInteger = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Parser requires non-negative integer ${key}`); return value as number;
};

export function parseAndNormalizeObservation(input: SourceObservationInput): NormalizedFactDraft[] {
  const subjectKey = typeof input.payload.subjectKey === 'string' && input.payload.subjectKey ? input.payload.subjectKey : input.externalEventKey;
  if (input.parserKey === 'generic.transaction.v1' || input.parserKey === 'mobile-notification-billing.v1') {
    const amountMinor = requireInteger(input.payload, 'amountMinor');
    const currency = requireString(input.payload, 'currency');
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Parser requires ISO currency');
    return [{ resourceType: 'finance.transaction', resourceKey: subjectKey, subjectKey, factKey: 'finance.transaction.amount', value: { amountMinor, currency }, confidence: input.parserKey === 'mobile-notification-billing.v1' ? 0.8 : 1, normalizerKey: 'money.v1', freshnessPolicyKey: 'transaction.default', conflictPolicyKey: 'latest_verified_then_observed', ...(input.parserKey === 'mobile-notification-billing.v1' ? { compatibilityResourceKey: 'mobile.billing.transaction' } : {}) }];
  }
  if (input.parserKey === 'generic.shipment-status.v1') {
    const status = requireString(input.payload, 'status');
    return [{ resourceType: 'shipment', resourceKey: subjectKey, subjectKey, factKey: 'shipment.status', value: { status }, confidence: 1, normalizerKey: 'shipment-status.v1', freshnessPolicyKey: 'shipment.status', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  const status = requireString(input.payload, 'status');
  return [{ resourceType: 'digital_account.connection', resourceKey: subjectKey, subjectKey, factKey: 'digital_account.connection.health', value: { status }, confidence: 1, normalizerKey: 'connection-health.v1', freshnessPolicyKey: 'connection.health', conflictPolicyKey: 'latest_verified_then_observed' }];
}

export function realityValueHash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
export function observationIdentity(providerKey: string, externalEventKey: string) { return createHash('sha256').update(`${providerKey}:${externalEventKey}`).digest('hex'); }
export function candidateDedupeKey(userId: string, draft: NormalizedFactDraft) { return realityValueHash({ userId, resourceType: draft.resourceType, resourceKey: draft.resourceKey, subjectKey: draft.subjectKey, factKey: draft.factKey, valueHash: realityValueHash(draft.value) }); }
