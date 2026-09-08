import { describe, expect, it } from 'vitest';
import { PROVIDER_REGISTRY, ProviderCapabilityRegistry, resolveCapabilityUsability, validateProviderCapabilityManifest } from '../src';

describe('provider capability manifest', () => {
  it('registers exactly 18 conservative provider skeletons', () => {
    const registry = new ProviderCapabilityRegistry();
    expect(PROVIDER_REGISTRY).toHaveLength(18);
    expect(registry.require('gmail')).toMatchObject({ providerReview: 'TO_VERIFY_OFFICIAL', revision: 1 });
    expect(registry.require('gmail').manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(registry.require('gmail').capabilities[0]).toMatchObject({ officialAvailability: 'TO_VERIFY_OFFICIAL', implementationStatus: 'NOT_IMPLEMENTED' });
  });

  it('fails closed for unsafe or contradictory capability claims', () => {
    const base = new ProviderCapabilityRegistry().require('gmail');
    expect(() => validateProviderCapabilityManifest({ ...base, capabilities: [{ ...base.capabilities[0]!, officialAvailability: 'UNAVAILABLE', implementationStatus: 'PRODUCTION' }] })).toThrow(/cannot be production/);
  });

  it('requires all four dimensions to be usable', () => {
    expect(resolveCapabilityUsability({ providerKey: 'gmail', capabilityKey: 'READ_EMAIL', providerAvailability: 'AVAILABLE', implementation: 'BETA', grant: 'GRANTED', health: 'HEALTHY' })).toMatchObject({ usable: true, reasons: [] });
    expect(resolveCapabilityUsability({ providerKey: 'gmail', capabilityKey: 'READ_EMAIL', providerAvailability: 'TO_VERIFY_OFFICIAL', implementation: 'NOT_IMPLEMENTED', grant: 'UNKNOWN', health: 'UNKNOWN' })).toMatchObject({ usable: false });
  });

  it.each([
    ['official denial', { providerAvailability: 'UNAVAILABLE' as const }, 'PROVIDER_CAPABILITY_UNAVAILABLE'],
    ['missing implementation', { implementation: 'NOT_IMPLEMENTED' as const }, 'CAPABILITY_NOT_IMPLEMENTED'],
    ['partial scope', { grant: 'PARTIAL' as const }, 'CAPABILITY_SCOPE_PARTIAL'],
    ['revoked grant', { grant: 'REVOKED' as const }, 'CAPABILITY_GRANT_REVOKED'],
    ['rate limit', { health: 'RATE_LIMITED' as const }, 'CAPABILITY_HEALTH_RATE_LIMITED'],
    ['provider outage', { health: 'PROVIDER_UNAVAILABLE' as const }, 'CAPABILITY_HEALTH_PROVIDER_UNAVAILABLE'],
    ['explicit denial', { explicitlyDenied: true }, 'CAPABILITY_EXPLICITLY_DENIED'],
  ])('fails closed for %s', (_label, override, reason) => {
    const result = resolveCapabilityUsability({
      providerKey: 'gmail',
      capabilityKey: 'READ_EMAIL',
      providerAvailability: 'AVAILABLE',
      implementation: 'PRODUCTION',
      grant: 'GRANTED',
      health: 'HEALTHY',
      ...override,
    });
    expect(result.usable).toBe(false);
    expect(result.reasons).toContain(reason);
  });
});
