import { catalogHash } from './runtime-catalog';

export const RESULT_STATES = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'] as const;
export type RuntimeResultState = typeof RESULT_STATES[number];
export type VerificationMethod = 'PROVIDER_RESPONSE' | 'OPERATION_LOOKUP' | 'USER_CONFIRMATION';
export interface VerificationPolicy {
  key: string;
  revision: string;
  providerKey: string | null;
  capabilityKey: string | null;
  methods: VerificationMethod[];
  timeoutMs: number;
  maxAttempts: number;
  expiresAfterMs: number;
  predicates: Array<{ path: string[]; equals: string | boolean | number; result: Exclude<RuntimeResultState, 'OUTCOME_UNKNOWN'> }>;
}

export function validateVerificationPolicy(policy: VerificationPolicy): void {
  if (!policy.key || !policy.revision || !policy.methods.length || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 30_000
    || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 20
    || !Number.isInteger(policy.expiresAfterMs) || policy.expiresAfterMs < 1 || policy.expiresAfterMs > 7 * 86400_000
    || policy.methods.some((method) => !['PROVIDER_RESPONSE', 'OPERATION_LOOKUP', 'USER_CONFIRMATION'].includes(method))) throw new Error('Invalid verification policy');
  const seen = new Set<string>();
  for (const predicate of policy.predicates) {
    const identity = JSON.stringify([predicate.path, predicate.equals]);
    if (!predicate.path.length || predicate.path.length > 8 || predicate.path.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))
      || !RESULT_STATES.includes(predicate.result) || predicate.result === ('OUTCOME_UNKNOWN' as string)
      || !['string', 'boolean', 'number'].includes(typeof predicate.equals) || (typeof predicate.equals === 'number' && !Number.isFinite(predicate.equals))
      || seen.has(identity)) throw new Error('Invalid or ambiguous verification predicate');
    seen.add(identity);
  }
}

export function evaluateVerification(policy: VerificationPolicy, method: VerificationMethod, evidence: unknown): RuntimeResultState {
  validateVerificationPolicy(policy);
  if (!policy.methods.includes(method)) return 'OUTCOME_UNKNOWN';
  const matched = new Set<RuntimeResultState>();
  for (const predicate of policy.predicates) {
    let value: unknown = evidence;
    for (const part of predicate.path) {
      value = value !== null && typeof value === 'object' && Object.hasOwn(value, part) ? (value as Record<string, unknown>)[part] : undefined;
    }
    if (value === predicate.equals) matched.add(predicate.result);
  }
  // Contradictory/missing evidence is not proof of success.
  return matched.size === 1 ? [...matched][0] : 'OUTCOME_UNKNOWN';
}

export function verificationPolicyHash(policy: VerificationPolicy): string { validateVerificationPolicy(policy); return catalogHash(policy); }

// Compatibility policy uses the existing ConnectorResult contract, not guessed provider fields.
export const CONNECTOR_RESPONSE_POLICY: VerificationPolicy = {
  key: 'connector-response', revision: '1', providerKey: null, capabilityKey: null, methods: ['PROVIDER_RESPONSE', 'USER_CONFIRMATION'],
  timeoutMs: 10_000, maxAttempts: 5, expiresAfterMs: 86400_000,
  predicates: [{ path: ['ok'], equals: true, result: 'SUCCEEDED' }, { path: ['ok'], equals: false, result: 'FAILED' }],
};
