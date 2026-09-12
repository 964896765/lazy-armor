import { describe, expect, it } from 'vitest';
import { CONNECTOR_RESPONSE_POLICY, evaluateVerification, verificationPolicyHash, type VerificationPolicy } from '../src';
describe('deterministic verification', () => {
  const policy: VerificationPolicy = { ...CONNECTOR_RESPONSE_POLICY, key: 'explicit-lookup', methods: ['OPERATION_LOOKUP'], predicates: [
    { path: ['status'], equals: 'done', result: 'SUCCEEDED' }, { path: ['status'], equals: 'partial', result: 'PARTIALLY_SUCCEEDED' },
    { path: ['status'], equals: 'rejected', result: 'FAILED' },
  ] };
  it.each([['done', 'SUCCEEDED'], ['partial', 'PARTIALLY_SUCCEEDED'], ['rejected', 'FAILED'], ['pending', 'OUTCOME_UNKNOWN']])('verifies explicit status %s', (status, result) => {
    expect(evaluateVerification(policy, 'OPERATION_LOOKUP', { status })).toBe(result);
  });
  it('fails closed for unsupported, missing, inherited or conflicting evidence', () => {
    expect(evaluateVerification(policy, 'OPERATION_LOOKUP', {})).toBe('OUTCOME_UNKNOWN');
    expect(evaluateVerification(policy, 'PROVIDER_RESPONSE', { status: 'done' })).toBe('OUTCOME_UNKNOWN');
    expect(evaluateVerification(policy, 'OPERATION_LOOKUP', Object.create({ status: 'done' }))).toBe('OUTCOME_UNKNOWN');
    expect(evaluateVerification({ ...policy, predicates: [...policy.predicates, { path: ['other'], equals: true, result: 'FAILED' }] }, 'OPERATION_LOOKUP', { status: 'done', other: true })).toBe('OUTCOME_UNKNOWN');
  });
  it('hashes revisions and rejects ambiguous definitions', () => {
    expect(verificationPolicyHash(policy)).not.toBe(verificationPolicyHash({ ...policy, revision: '2' }));
    expect(() => verificationPolicyHash({ ...policy, predicates: [...policy.predicates, policy.predicates[0]] })).toThrow();
    expect(() => verificationPolicyHash({ ...policy, timeoutMs: 31_000 })).toThrow();
  });
});
