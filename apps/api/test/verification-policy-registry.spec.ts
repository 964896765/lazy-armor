import { describe, expect, it } from 'vitest';
import { CONNECTOR_RESPONSE_POLICY } from '@lazy-armor/plan-schema';
import { VerificationPolicyRegistry } from '../src/execution/verification-policy-registry.service';
describe('VerificationPolicyRegistry', () => {
  it('keeps revisions immutable and requires explicit provider capability bindings', () => {
    const registry = new VerificationPolicyRegistry();
    expect(() => registry.register({ ...CONNECTOR_RESPONSE_POLICY, timeoutMs: 1 })).toThrow('immutable');
    expect(() => registry.register({ ...CONNECTOR_RESPONSE_POLICY, key: 'unbound', providerKey: 'provider' })).toThrow('explicit capability');
  });
  it('returns defensive copies and uses a conservative fallback for unverified providers', () => {
    const registry = new VerificationPolicyRegistry();
    const copy = registry.select('unverified', 'PAY'); copy.methods.push('OPERATION_LOOKUP');
    expect(registry.select('unverified', 'PAY').methods).not.toContain('OPERATION_LOOKUP');
    const policy = { ...CONNECTOR_RESPONSE_POLICY, key: 'bound', providerKey: 'fixture', capabilityKey: 'TEST', methods: ['OPERATION_LOOKUP' as const] };
    registry.register(policy); policy.methods.length = 0;
    expect(registry.select('fixture', 'TEST').methods).toEqual(['OPERATION_LOOKUP']);
  });
});
