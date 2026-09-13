import { describe, expect, it } from 'vitest';
import type { ProviderVerificationPolicy, ProviderResultState } from '@lazy-armor/connector-sdk';
import { ProviderRuntimeService } from '../src/provider-runtime/provider-runtime.service';
const policy: ProviderVerificationPolicy = { key: 'test.verify', revision: '1', providerKey: 'test', capabilityKey: 'WRITE_TEST',
  methods: ['OPERATION_LOOKUP'], timeoutMs: 1000, maxAttempts: 1, expiresAfterMs: 60_000,
  predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' }, { path: ['status'], equals: 'partial', result: 'PARTIALLY_SUCCEEDED' }, { path: ['status'], equals: 'rejected', result: 'FAILED' }] };
// This pure seam delegates to the existing verification VM; no DB/Runner mocks are needed.
const verify = ProviderRuntimeService.prototype.verifyEvidence;
describe('Provider evidence deterministic compatibility', () => {
  it.each([['done', 'SUCCEEDED'], ['partial', 'PARTIALLY_SUCCEEDED'], ['rejected', 'FAILED'], ['pending', 'OUTCOME_UNKNOWN']] as Array<[string, ProviderResultState]>)('evaluates %s', (status, state) => {
    expect(verify(policy, { state, method: 'OPERATION_LOOKUP', evidence: { status } })).toBe(state);
  });
  it('missing, disallowed and contradictory evidence cannot be promoted by an adapter', () => {
    expect(verify(policy, { state: 'SUCCEEDED', method: 'OPERATION_LOOKUP', evidence: {} })).toBe('OUTCOME_UNKNOWN');
    expect(verify(policy, { state: 'SUCCEEDED', method: 'PROVIDER_RESPONSE', evidence: { status: 'done' } })).toBe('OUTCOME_UNKNOWN');
    expect(verify(policy, { state: 'SUCCEEDED', method: 'OPERATION_LOOKUP', evidence: { status: 'partial' } })).toBe('OUTCOME_UNKNOWN');
  });
});
