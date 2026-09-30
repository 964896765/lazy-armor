import { describe, expect, it } from 'vitest';
import { actionResolutionContractHash, buildVerificationContract, CONNECTOR_RESPONSE_POLICY, evaluateVerification,
  verificationContractHash, verificationPolicyHash, type ActionResolutionContract, type VerificationPolicy } from '../src';
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

  it('freezes the selected provider policy and rejects cross-capability reuse', () => {
    const providerPolicy: VerificationPolicy = { ...policy, providerKey: 'delivery', capabilityKey: 'DELIVERY_WRITE' };
    const contract = buildVerificationContract('delivery', 'DELIVERY_WRITE', providerPolicy);
    expect(verificationContractHash(contract)).toHaveLength(64);
    expect(() => buildVerificationContract('delivery', 'BILL_READ', providerPolicy)).toThrow('does not match');
    expect(() => verificationContractHash({ ...contract, policyHash: '0'.repeat(64) })).toThrow('Invalid');
  });

  it('hashes the immutable action resolution including verification identity', () => {
    const contract: ActionResolutionContract = {
      version: '1', planVersionId: 'pv-1', actionIntentId: 'ai-1', actionIntentHash: 'a'.repeat(64),
      adapterRevision: 1, adapterKey: 'existing-runner:notify', connectorId: 'c-1', connectionId: 'cn-1',
      capabilityKey: 'NOTIFY', capabilityResolutionDecisionId: 'r-1', capabilityResolutionDecisionHash: 'b'.repeat(64),
      riskInputFingerprint: 'c'.repeat(64), effectiveRisk: 'R1', verificationContractHash: 'd'.repeat(64),
    };
    expect(actionResolutionContractHash(contract)).not.toBe(actionResolutionContractHash({ ...contract, connectionId: 'cn-2' }));
  });
});
