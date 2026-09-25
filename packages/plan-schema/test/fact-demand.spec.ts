import { describe, expect, it } from 'vitest';
import {
  buildFactDemandProjections,
  scenarioContractV2ByKey,
  type FactDemandRequest,
  type FactTruthEvidence,
  type ScenarioContractV2,
  type SourceCandidateEvidence,
} from '../src';

const contract = scenarioContractV2ByKey('daily_life.delivery')!;
const request: FactDemandRequest = {
  scenarioKey: 'daily_life.delivery',
  scenarioRevision: 2,
  goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '物流变化时提醒', constraints: {} },
  subject: { resourceType: 'shipment', subjectKey: 'shipment:SF001' },
};
const now = '2026-09-25T12:00:00.000Z';

function source(overrides: Partial<SourceCandidateEvidence> = {}): SourceCandidateEvidence {
  return {
    sourceId: 'connection:connection-1:READ_SHIPMENT', kind: 'PROVIDER_CONNECTION', providerKey: 'provider-1', connectionId: 'connection-1',
    sourceMode: 'OFFICIAL_API', capabilityKey: 'READ_SHIPMENT', discovered: true, ownedByUser: true,
    trustedDeviceId: null, deviceAppConnectionId: null, truthRecordId: null, truthVersionId: null,
    implemented: true, authorized: true, deviceOnline: true, healthy: true, contractCompatible: true,
    estimatedLatencyMs: 500, costClass: 'FREE', evidenceRefs: ['connection:connection-1'], reasonCodes: [],
    ...overrides,
  };
}

function truth(overrides: Partial<FactTruthEvidence> = {}): FactTruthEvidence {
  return {
    truthRecordId: 'truth-1', truthVersionId: 'truth-version-1', factKey: 'shipment.status',
    subjectKey: 'shipment:SF001', sourceProviderKey: 'provider-1', sourceMode: 'OFFICIAL_API',
    valueHash: 'a'.repeat(64), realityLevel: 'VERIFIED', verified: true,
    observedAt: '2026-09-25T11:59:00.000Z', createdAt: '2026-09-25T11:59:00.000Z', conflict: false,
    ...overrides,
  };
}

function project(sources: SourceCandidateEvidence[], truths: FactTruthEvidence[] = []) {
  return buildFactDemandProjections({ request, contract, sources, truths, evaluatedAt: now })[0]!;
}

describe('FactDemand contract and deterministic Source Resolution', () => {
  it('rejects an illegal object, intent, scenario revision, and client-injected fact fields', () => {
    expect(() => buildFactDemandProjections({ request: { ...request, subject: { resourceType: 'transaction', subjectKey: 'x' } }, contract, sources: [], truths: [], evaluatedAt: now })).toThrow('ResourceSubject type');
    expect(() => buildFactDemandProjections({ request: { ...request, goal: { ...request.goal, intent: 'PAY_ORDER' } }, contract, sources: [], truths: [], evaluatedAt: now })).toThrow('Goal intent');
    expect(() => buildFactDemandProjections({ request: { ...request, scenarioRevision: 1 }, contract, sources: [], truths: [], evaluatedAt: now })).toThrow('immutable Scenario Contract revision');
    expect(() => buildFactDemandProjections({ request: { ...request, factKey: 'finance.transaction.amount' } as never, contract, sources: [], truths: [], evaluatedAt: now })).toThrow();
  });

  it.each([
    ['NEEDS_SOURCE', []],
    ['SOURCE_NOT_IMPLEMENTED', [source({ implemented: false })]],
    ['NEEDS_PERMISSION', [source({ authorized: false })]],
    ['DEVICE_OFFLINE', [source({ sourceMode: 'NOTIFICATION', capabilityKey: null, deviceOnline: false })]],
    ['PROVIDER_UNHEALTHY', [source({ healthy: false })]],
    ['PENDING_ACQUISITION', [source()]],
  ] as const)('keeps source failure state %s explicit', (expected, sources) => {
    const result = project([...sources]);
    expect(result.state).toBe(expected);
    expect(result.dataActuallyAcquired).toBe(false);
    expect(result.dataVerified).toBe(false);
  });

  it('keeps discovered, owned, usable, acquired and verified as separate dimensions', () => {
    const result = project([source()], [truth()]);
    expect(result).toMatchObject({
      state: 'SATISFIED', capabilityDiscovered: true, userOwnsSource: true,
      sourceCurrentlyUsable: true, dataActuallyAcquired: true, dataVerified: true,
    });
    expect(result.selectedSourceId).toBe('connection:connection-1:READ_SHIPMENT');
    expect(result.selectedSource).toMatchObject({ kind: 'PROVIDER_CONNECTION', connectionId: 'connection-1' });
  });

  it('marks old data stale, fresh unverified data pending verification, and identical duplicates non-conflicting', () => {
    expect(project([source()], [truth({ createdAt: '2026-09-23T00:00:00.000Z' })]).state).toBe('STALE');
    expect(project([source()], [truth({ verified: false, realityLevel: 'CLAIMED' })]).state).toBe('NEEDS_VERIFICATION');
    const duplicate = project([source()], [truth(), truth({ truthRecordId: 'truth-2', truthVersionId: 'truth-version-2' })]);
    expect(duplicate.state).toBe('SATISFIED');
  });

  it('does not guess when multiple verified sources conflict', () => {
    const result = project([source(), source({ sourceId: 'connection:connection-2:READ_SHIPMENT', connectionId: 'connection-2', providerKey: 'provider-2' })], [
      truth(), truth({ truthRecordId: 'truth-2', truthVersionId: 'truth-version-2', sourceProviderKey: 'provider-2', valueHash: 'b'.repeat(64) }),
    ]);
    expect(result.state).toBe('CONFLICT');
    expect(result.dataVerified).toBe(false);
    expect(result.reasonCodes).toContain('TRUTH_SOURCE_CONFLICT_REQUIRES_EXISTING_REALITY_POLICY');
  });

  it('ignores a discovered capability that is not allowed by the scenario contract', () => {
    const result = project([source({ capabilityKey: 'READ_BANK_BALANCE', sourceMode: 'OS_API' })]);
    expect(result.state).toBe('NEEDS_SOURCE');
    expect(result.candidateSources).toHaveLength(0);
  });

  it('uses a user-scoped verified INTERNAL truth as an INTERNAL_FACT identity when the contract allows it', () => {
    const internalContract = {
      ...contract,
      definitionHash: 'c'.repeat(64),
      factDemands: contract.factDemands.map((item) => ({ ...item, acceptedSourceModes: ['INTERNAL'] as const })),
    } as ScenarioContractV2;
    const result = buildFactDemandProjections({ request, contract: internalContract, sources: [], truths: [truth({
      sourceMode: 'INTERNAL', sourceProviderKey: 'lazy-armor-internal',
    })], evaluatedAt: now })[0]!;
    expect(result).toMatchObject({ state: 'SATISFIED', sourceCurrentlyUsable: true,
      selectedSource: { kind: 'INTERNAL_FACT', truthRecordId: 'truth-1', truthVersionId: 'truth-version-1' } });
  });
});
