import { describe, expect, it } from 'vitest';
import { approvalSnapshotInvalidation, buildActionIntent, riskMaximum, type ApprovalSnapshot } from '../src/action-runtime';

describe('action runtime contracts', () => {
  it('never lowers provider, scenario, action, or contextual risk floors', () => {
    const intent = buildActionIntent({ intentId: 'intent-1', planVersionId: 'version-1', planActionId: 'action-1', actionType: 'publish',
      capabilityKey: 'PUBLISH', resourceType: 'Publication', target: { channel: 'public' }, payload: { body: 'hello' },
      desiredOutcome: 'Publication is visible', sideEffectKey: 'publish:1', providerRiskFloor: 'R2', scenarioRiskFloor: 'R1',
      actionRisk: 'R3', contextSignals: [{ code: 'PUBLIC_VISIBILITY', floor: 'R3' }] });
    expect(intent).toMatchObject({ payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), contextRiskElevation: 'R3', effectiveRisk: 'R3' });
    expect(buildActionIntent({ ...intent, providerRiskFloor: 'R4' }).effectiveRisk).toBe('R4');
    expect(buildActionIntent(intent).intentHash).toBe(intent.intentHash);
    expect(() => riskMaximum('constructor' as 'R0')).toThrow();
  });

  it('invalidates approval when immutable action identity changes or expires', () => {
    const snapshot: ApprovalSnapshot = { schemaVersion: '1', executionId: 'e', executionStepId: 's', planVersionId: 'v', planActionId: 'a',
      actionIntentId: 'i', actionIntentHash: 'h', capabilityKey: 'SEND', connectorId: 'c', connectionId: 'n', inputFingerprint: 'f',
      effectiveRisk: 'R3', amountMinor: 100, currency: 'CNY', sideEffectKey: 'k', expiresAt: '2026-01-01T00:00:00.000Z' };
    expect(approvalSnapshotInvalidation(snapshot, { ...snapshot, amountMinor: 200 }, '2025-01-01T00:00:00.000Z')).toContain('AMOUNT_MINOR_CHANGED');
    expect(approvalSnapshotInvalidation(snapshot, snapshot, '2026-01-01T00:00:00.000Z')).toEqual(['APPROVAL_EXPIRED']);
    for (const key of ['planVersionId', 'planActionId', 'capabilityKey', 'connectionId', 'actionIntentHash', 'sideEffectKey', 'expiresAt'] as const) {
      const changed = { ...snapshot, [key]: key === 'expiresAt' ? '2026-01-02T00:00:00.000Z' : 'changed' };
      expect(approvalSnapshotInvalidation(snapshot, changed, '2025-01-01T00:00:00.000Z').length).toBeGreaterThan(0);
    }
  });
});
