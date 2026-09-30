import { describe, expect, it } from 'vitest';
import { isConsumerReadinessProjection, type ScenarioReadiness } from '@lazy-armor/plan-schema';
import type { CapabilityReadinessEvidence } from '../src/runtime-catalog/readiness-evidence.service';
import { projectConsumerReadiness } from '../src/runtime-catalog/readiness-product-projection';

const readiness = (overrides: Partial<ScenarioReadiness> = {}): ScenarioReadiness => ({
  scenarioKey: 'daily_life.shipment', state: 'AUTOMATED_READY', missingFacts: [], missingCapabilities: [], reasons: [], evaluatedAgainstRevision: 1, ...overrides,
});
const capability = (overrides: Partial<CapabilityReadinessEvidence> = {}): CapabilityReadinessEvidence => ({
  capabilityKey: 'READ_SHIPMENT', providerKey: 'test', connectionId: 'connection-1', operation: 'read', riskLevel: 'R1',
  dimensions: { declared: true, implemented: true, authorized: true, healthy: true, executable: true, verifiable: true },
  providerAvailability: 'AVAILABLE', implementation: 'PRODUCTION', grant: 'GRANTED', health: 'HEALTHY', usable: true, reasons: [], ...overrides,
});

describe('consumer readiness projection', () => {
  it('keeps platform implementation separate from user authorization', () => {
    const result = projectConsumerReadiness({ readiness: readiness({ missingCapabilities: ['READ_SHIPMENT'] }), capabilities: [capability({ grant: 'REVOKED', usable: false })], platformSupported: true, deviceRequired: false, deviceOnline: false });
    expect(result).toMatchObject({ productReadiness: 'IMPLEMENTED', userReadiness: 'NEEDS_PERMISSION', actionPath: '/connections' });
    expect(isConsumerReadinessProjection(result)).toBe(true);
  });

  it('never presents an unverified provider as usable', () => {
    const result = projectConsumerReadiness({ readiness: readiness(), capabilities: [capability()], platformSupported: false, deviceRequired: false, deviceOnline: true });
    expect(result).toMatchObject({ productReadiness: 'NOT_VERIFIED', userReadiness: 'SERVICE_UNAVAILABLE' });
  });

  it('requires fresh facts and an online device when relevant', () => {
    const missing = readiness({ state: 'CATALOG_ONLY', missingFacts: ['shipment.status'], reasons: ['REQUIRED_FACTS_UNAVAILABLE'] });
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [capability()], platformSupported: true, deviceRequired: false, deviceOnline: false }).userReadiness).toBe('NEEDS_DATA');
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [capability()], platformSupported: true, deviceRequired: true, deviceOnline: false }).userReadiness).toBe('DEVICE_OFFLINE');
  });

  it('distinguishes an existing connection with missing scope from no connection', () => {
    const missing = readiness({ state: 'BLOCKED_PROVIDER', missingCapabilities: ['READ_SHIPMENT'] });
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [capability({ grant: 'PARTIAL', usable: false })], platformSupported: true, deviceRequired: false, deviceOnline: true }).userReadiness).toBe('NEEDS_PERMISSION');
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [], platformSupported: true, deviceRequired: false, deviceOnline: true }).userReadiness).toBe('NEEDS_CONNECTION');
  });

  it('does not suggest connecting again when the provider or device is unhealthy', () => {
    const missing = readiness({ state: 'BLOCKED_PROVIDER', missingCapabilities: ['READ_SHIPMENT'] });
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [capability({ health: 'RATE_LIMITED', usable: false })], platformSupported: true, deviceRequired: false, deviceOnline: true }).userReadiness).toBe('SERVICE_UNAVAILABLE');
    expect(projectConsumerReadiness({ readiness: missing, capabilities: [capability({ health: 'DEVICE_OFFLINE', usable: false })], platformSupported: true, deviceRequired: false, deviceOnline: true }).userReadiness).toBe('DEVICE_OFFLINE');
  });
});
