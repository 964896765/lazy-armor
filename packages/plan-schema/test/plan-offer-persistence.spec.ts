import { describe, expect, it } from 'vitest';
import { assessPlanAvailability, buildPersistentPlanOffer, choosePlanOfferRequestSchema, planOfferPreconditionHash,
  type FactDemandProjection } from '../src/index';

const demand = (overrides: Partial<FactDemandProjection> = {}): FactDemandProjection => ({
  contractVersion: 1, demandId: 'fd_test', scenario: { key: 'daily_life.delivery', revision: 2, contractHash: 'a'.repeat(64) },
  goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '提醒我', constraints: {} },
  subject: { resourceType: 'shipment', subjectKey: 'shipment:1' }, factKey: 'shipment.status', subjectType: 'shipment',
  required: true, maximumAgeSeconds: 60, minimumReality: 'OBSERVED', refreshPolicy: 'ON_STALE',
  verificationRequirements: ['SOURCE_EVIDENCE'], conflictPolicy: 'LATEST_VERIFIED_THEN_OBSERVED',
  missingPolicy: 'BLOCK_PLAN_OFFER', state: 'PENDING_ACQUISITION', capabilityDiscovered: true, userOwnsSource: true,
  sourceCurrentlyUsable: true, dataActuallyAcquired: false, dataVerified: false, selectedSourceId: 'device-app:1',
  selectedSource: { schemaVersion: 1, kind: 'TRUSTED_DEVICE', sourceId: 'device-app:1', connectionId: null,
    capabilityKey: 'READ_SHIPMENT', trustedDeviceId: 'device-1', deviceAppConnectionId: '1', truthRecordId: null, truthVersionId: null },
  candidateSources: [{ sourceId: 'device-app:1', kind: 'TRUSTED_DEVICE', providerKey: 'cainiao', connectionId: null, sourceMode: 'NOTIFICATION',
    capabilityKey: 'READ_SHIPMENT', discovered: true, ownedByUser: true, implemented: true, authorized: true,
    trustedDeviceId: 'device-1', deviceAppConnectionId: '1', truthRecordId: null, truthVersionId: null,
    deviceOnline: true, healthy: true, contractCompatible: true, estimatedLatencyMs: 10, costClass: 'FREE',
    evidenceRefs: [], reasonCodes: [], rank: 1000, usable: true, acquired: false, verified: false }],
  truthEvidence: [], reasonCodes: [], evaluatedAt: '2026-09-25T00:00:00.000Z', ...overrides,
});
const request = { scenarioKey: 'daily_life.delivery', scenarioRevision: 2,
  goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '提醒我', constraints: {} },
  subject: { resourceType: 'shipment', subjectKey: 'shipment:1' } };

describe('persistent Plan Offer contract', () => {
  it('allows a draft only with a currently usable source and never promises execution', () => {
    const offer = buildPersistentPlanOffer({ request, demands: [demand()], contractHash: 'a'.repeat(64),
      strategyKey: 'SILENT_FOLLOW_UP', planDefinitionHash: 'b'.repeat(64), generatedAt: '2026-09-25T00:00:00.000Z' });
    expect(offer).toMatchObject({ contractVersion: 2, state: 'DRAFT_ELIGIBLE', selectable: true, planMode: 'DRAFT',
      sourceSelections: [{ demandId: 'fd_test', selection: { kind: 'TRUSTED_DEVICE' } }] });
    expect(offer.sourceSelectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(offer.reasonCodes).toContain('EXECUTION_CAPABILITY_NOT_YET_PROMISED');
  });

  it.each(['CONFLICT', 'STALE', 'NEEDS_VERIFICATION'] as const)('blocks unverifiable state %s', (state) => {
    const offer = buildPersistentPlanOffer({ request, demands: [demand({ state })], contractHash: 'a'.repeat(64),
      strategyKey: 'SILENT_FOLLOW_UP', planDefinitionHash: 'b'.repeat(64), generatedAt: '2026-09-25T00:00:00.000Z' });
    expect(offer).toMatchObject({ state: 'NEEDS_REQUIREMENTS', selectable: false });
  });

  it('fingerprints authorization and evidence versions but not evaluation time', () => {
    expect(planOfferPreconditionHash([demand({ evaluatedAt: '2026-09-25T00:00:00.000Z' })]))
      .toBe(planOfferPreconditionHash([demand({ evaluatedAt: '2026-09-25T00:00:10.000Z' })]));
    const unauthorized = demand({ candidateSources: [{ ...demand().candidateSources[0]!, authorized: false }] });
    expect(planOfferPreconditionHash([demand()])).not.toBe(planOfferPreconditionHash([unauthorized]));
  });

  it('strictly validates choose idempotency keys', () => {
    expect(() => choosePlanOfferRequestSchema.parse({ idempotencyKey: 'short' })).toThrow();
    expect(() => choosePlanOfferRequestSchema.parse({ idempotencyKey: 'valid-key', injected: true })).toThrow();
  });

  it('separates refreshable facts from changes that require a new confirmation', () => {
    const selection = [{ demandId: 'fd_test', selectedSourceId: 'device-app:1' }];
    expect(assessPlanAvailability({ expectedContractHash: 'a', currentContractHash: 'a', previousSelections: selection,
      currentDemands: [demand()], evaluatedAt: '2026-09-25T00:00:00.000Z' })).toMatchObject({
      state: 'REFRESH_REQUIRED', reasonCodes: ['FACT_DEMAND_PENDING_ACQUISITION'],
    });
    expect(assessPlanAvailability({ expectedContractHash: 'a', currentContractHash: 'a', previousSelections: selection,
      currentDemands: [demand({ state: 'DEVICE_OFFLINE', sourceCurrentlyUsable: false, selectedSourceId: null })],
      evaluatedAt: '2026-09-25T00:00:00.000Z' })).toMatchObject({ state: 'RECONFIRMATION_REQUIRED' });
    expect(assessPlanAvailability({ expectedContractHash: 'a', currentContractHash: 'a', previousSelections: selection,
      currentDemands: [demand({ state: 'SATISFIED', dataActuallyAcquired: true, dataVerified: true })],
      evaluatedAt: '2026-09-25T00:00:00.000Z' })).toMatchObject({ state: 'CURRENT' });
  });
});
