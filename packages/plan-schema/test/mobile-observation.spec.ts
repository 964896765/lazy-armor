import { describe, expect, it } from 'vitest';
import { mobileCandidateKindForParser, resolveMobileCandidateSpec, toSourceObservationInput } from '../src/index';

describe('mobile observation envelope', () => {
  it('resolves the four P3 parser keys to their candidate kinds', () => {
    expect(mobileCandidateKindForParser('mobile-notification-billing.v1')).toBe('transaction');
    expect(mobileCandidateKindForParser('generic.shipment-status.v1')).toBe('shipment');
    expect(mobileCandidateKindForParser('generic.bill-reminder.v1')).toBe('bill');
    expect(mobileCandidateKindForParser('generic.device-status.v1')).toBe('device');
  });

  it('fails closed on an unknown parser key', () => {
    expect(mobileCandidateKindForParser('generic.unknown.v1')).toBeNull();
    expect(resolveMobileCandidateSpec('garbage')).toBeNull();
  });

  it('threads deviceId and packageName into the source observation input', () => {
    const spec = resolveMobileCandidateSpec('shipment')!;
    const input = toSourceObservationInput({
      sourceType: 'NOTIFICATION',
      packageName: 'com.example.courier',
      candidateKind: 'shipment',
      parserId: spec.parserId,
      resourceHint: spec.resourceHint,
      observedAt: '2026-01-01T00:00:00.000Z',
      evidenceHash: 'a'.repeat(64),
      sourceRef: 'event-1',
      deviceId: 'trusted-device-1',
      payload: { status: 'IN_TRANSIT' },
    }, 'com.example.courier', null);
    expect(input.deviceId).toBe('trusted-device-1');
    expect(input.externalEventKey).toBe('event-1');
    expect(input.sourceMode).toBe('NOTIFICATION');
    expect(input.payload.packageName).toBe('com.example.courier');
  });
});
