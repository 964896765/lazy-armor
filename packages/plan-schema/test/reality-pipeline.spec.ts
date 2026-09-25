import { describe, expect, it } from 'vitest';
import { candidateDedupeKey, parseAndNormalizeObservation, type SourceObservationInput } from '../src';

const base = (parserKey: SourceObservationInput['parserKey'], payload: SourceObservationInput['payload']): SourceObservationInput => ({
  sourceMode: 'INTERNAL', providerKey: 'test', externalEventKey: 'event-1', parserKey, resourceHint: 'test', payload,
  evidenceHash: 'a'.repeat(64), observedAt: '2026-09-08T00:00:00.000Z', occurredAt: null,
});

describe('generic reality parser and normalizer registry', () => {
  it.each([
    ['generic.transaction.v1', { subjectKey: 'tx-1', amountMinor: 12850, currency: 'CNY' }, 'finance.transaction.amount'],
    ['generic.shipment-status.v1', { subjectKey: 'shipment-1', status: 'IN_TRANSIT' }, 'shipment.status'],
    ['generic.connection-health.v1', { subjectKey: 'connection-1', status: 'HEALTHY' }, 'digital_account.connection.health'],
    ['generic.device-status.v1', { subjectKey: 'device-1', status: 'ONLINE' }, 'device_status.status.state'],
    ['generic.bill-reminder.v1', { subjectKey: 'bill-1', status: 'DUE' }, 'bill.bill.state'],
  ] as const)('normalizes %s through one contract', (parser, payload, factKey) => {
    expect(parseAndNormalizeObservation(base(parser, payload))).toEqual([expect.objectContaining({ factKey, confidence: 1 })]);
  });

  it('adapts the legacy mobile billing candidate without trusting raw notification content', () => {
    expect(parseAndNormalizeObservation(base('mobile-notification-billing.v1', { amountMinor: 1990, currency: 'CNY' }))[0]).toMatchObject({ factKey: 'finance.transaction.amount', compatibilityResourceKey: 'mobile.billing.transaction' });
  });

  it('matches cross-source transactions only on a source-supplied stable identifier', () => {
    const withId = parseAndNormalizeObservation(base('generic.transaction.v1', {
      subjectKey: 'file-row-1', transactionId: 'bank:txn-001', relatedTransactionId: 'bank:original-001',
      amountMinor: 2580, currency: 'CNY', merchant: '测试商户', direction: 'CREDIT', transactionState: 'REFUND',
    }))[0];
    const withoutId = parseAndNormalizeObservation(base('generic.transaction.v1', {
      subjectKey: 'file-row-2', amountMinor: 2580, currency: 'CNY', merchant: '测试商户',
    }))[0];
    expect(withId).toMatchObject({ subjectKey: 'finance.transaction:bank:txn-001', resourceKey: 'finance.transaction:bank:txn-001',
      value: expect.objectContaining({ transactionId: 'bank:txn-001', relatedTransactionId: 'bank:original-001', transactionState: 'REFUND' }) });
    expect(withoutId.subjectKey).toBe('file-row-2');
  });

  it('deduplicates by semantic identity and normalized value', () => {
    const draft = parseAndNormalizeObservation(base('generic.shipment-status.v1', { subjectKey: 's1', status: 'DELIVERED' }))[0];
    expect(candidateDedupeKey('u1', draft)).toBe(candidateDedupeKey('u1', { ...draft, value: { status: 'DELIVERED' } }));
    expect(candidateDedupeKey('u1', draft)).not.toBe(candidateDedupeKey('u1', { ...draft, value: { status: 'IN_TRANSIT' } }));
  });

  it('fails closed on malformed parser input', () => {
    expect(() => parseAndNormalizeObservation(base('generic.transaction.v1', { amountMinor: -1, currency: 'CNY' }))).toThrow();
  });
});
