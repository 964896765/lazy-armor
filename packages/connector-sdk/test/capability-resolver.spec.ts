import { describe, expect, it } from 'vitest';
import { candidateCapability } from '../src/capability-manifest';
import { resolveCapability, type CapabilityRequirement, type ResolutionCandidate } from '../src/capability-resolver';

const now = '2026-09-10T00:00:00.000Z';
const requirement: CapabilityRequirement = { schemaVersion: '1', capabilityKey: 'READ_STATUS', resource: 'shipment', operation: 'read',
  fields: ['status'], purpose: 'tracking', minimumReality: 'VERIFIED', maxAgeSeconds: 60, maxRisk: 'R1', maxCostMicros: 100,
  preferredProviders: ['preferred'], preferredSourceModes: ['OFFICIAL_API'] };
function candidate(id = 'a'): ResolutionCandidate {
  const capability = candidateCapability({ key: 'READ_STATUS', name: 'Test shipment status', resource: 'shipment', sourceModes: ['OFFICIAL_API'] });
  return { id, providerKey: id, manifestHash: 'test-only', manifestRevision: 1,
    capability: { ...capability, officialAvailability: 'AVAILABLE', implementationStatus: 'PRODUCTION', reviewStatus: 'VERIFIED',
      dataBoundary: { resources: ['shipment'], readableFields: ['status'], writableFields: [], purpose: ['tracking'] }, verificationMethods: ['READ_BACK'] },
    connectionReady: true, grantSatisfied: true, healthUsable: true, accountSatisfied: true, deviceSatisfied: true, explicitlyDenied: false,
    reality: 'VERIFIED', observedAt: now, costMicros: 0, latencyMs: 10, reliability: 0.99 };
}

describe('capability resolver', () => {
  it('selects by semantic capability without requiring a provider name', () => {
    expect(resolveCapability(requirement, [candidate()], now)).toMatchObject({ status: 'RESOLVED', selectedCandidateId: 'a', executionAuthorized: false });
  });

  it.each([
    ['official', (c: ResolutionCandidate) => { c.capability.officialAvailability = 'TO_VERIFY_OFFICIAL'; }],
    ['implementation', (c: ResolutionCandidate) => { c.capability.implementationStatus = 'PARTIAL'; }],
    ['grant', (c: ResolutionCandidate) => { c.grantSatisfied = false; }],
    ['health', (c: ResolutionCandidate) => { c.healthUsable = false; }],
    ['account', (c: ResolutionCandidate) => { c.accountSatisfied = false; }],
    ['device', (c: ResolutionCandidate) => { c.deviceSatisfied = false; }],
    ['reality', (c: ResolutionCandidate) => { c.reality = 'CLAIMED'; }],
    ['freshness', (c: ResolutionCandidate) => { c.observedAt = '2026-09-09T00:00:00Z'; }],
    ['future timestamp', (c: ResolutionCandidate) => { c.observedAt = '2026-09-11T00:00:00Z'; }],
    ['risk', (c: ResolutionCandidate) => { c.capability.riskLevel = 'R3'; }],
    ['boundary', (c: ResolutionCandidate) => { c.capability.dataBoundary.readableFields = []; }],
    ['denial', (c: ResolutionCandidate) => { c.explicitlyDenied = true; }],
    ['unknown cost', (c: ResolutionCandidate) => { c.costMicros = null; }],
    ['cost ceiling', (c: ResolutionCandidate) => { c.costMicros = 101; }],
    ['resource semantics', (c: ResolutionCandidate) => { c.capability.resources = ['email']; }],
  ])('fails closed for %s despite ranking preferences', (_name, mutate) => {
    const c = candidate('preferred'); mutate(c);
    const result = resolveCapability(requirement, [c], now);
    expect(result.status).toBe('BLOCKED'); expect(result.candidates[0].reasons.length).toBeGreaterThan(0);
  });

  it('ranks deterministically by reliability before cost and preference and breaks ties by stable identity', () => {
    const a = candidate('a'); const b = candidate('preferred'); b.reliability = 0.5;
    expect(resolveCapability(requirement, [b, a], now).selectedCandidateId).toBe('a');
    expect(resolveCapability(requirement, [candidate('z'), a], now)).toEqual(resolveCapability(requirement, [a, candidate('z')], now));
    expect(resolveCapability(requirement, [a, b], now).fallbackCandidates[0]).toMatchObject({ policy: 'REVALIDATE_BEFORE_READ', automatic: false });
  });

  it('never authorizes automatic cross-provider write retries', () => {
    const a = candidate(); const b = candidate('b');
    for (const c of [a, b]) { c.capability.operation = 'execute'; c.capability.sideEffectContract.sideEffect = true; c.capability.dataBoundary.writableFields = ['status']; }
    expect(resolveCapability({ ...requirement, operation: 'execute' }, [a, b], now).fallbackCandidates[0])
      .toMatchObject({ policy: 'REQUIRES_OUTCOME_RECONCILIATION', automatic: false });
  });
});
