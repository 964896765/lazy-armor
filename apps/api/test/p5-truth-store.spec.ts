import { describe, expect, it, vi } from 'vitest';
import { TruthStoreService } from '../src/truth-store/truth-store.service';

const receipt = {
  id: 'receipt-1', userId: 'user-1', sourcePackage: 'com.example.bank', payloadHash: 'a'.repeat(64),
  amountMinor: 12345, receivedAt: new Date('2026-09-04T00:00:01.000Z'), postedAt: new Date('2026-09-04T00:00:00.000Z'),
  snapshotJson: { schema: 'mobile-notification-minimal-v2', candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 70, currency: 'CNY', parserVersion: 'generic-notification-v1' },
};

function completedTruthRecord(overrides: Record<string, unknown> = {}) {
  return { id: 'truth-existing', userId: 'user-1', resourceKey: 'mobile.billing.transaction', subjectKey: 'receipt-1', status: 'verified', currentVersionId: 'version-existing', sourceReceiptId: 'receipt-1', verifiedBy: 'user_confirmation', verifiedAt: new Date('2026-09-04T00:01:00.000Z'), revokedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function fixture(options: { existing?: ReturnType<typeof completedTruthRecord>; ingestError?: unknown; confirmError?: unknown; noCandidate?: boolean } = {}) {
  const limit = vi.fn(async () => options.existing ? [options.existing] : []);
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) }));
  const db = { select };
  const audit = { append: vi.fn(async () => undefined) };
  const ingest = vi.fn(async () => {
    if (options.ingestError) throw options.ingestError;
    return { candidates: options.noCandidate ? [] : [{ id: 'candidate-1' }] };
  });
  const confirmCandidate = vi.fn(async () => {
    if (options.confirmError) throw options.confirmError;
    return { id: 'truth-1', resourceKey: 'mobile.billing.transaction', status: 'verified', sourceReceiptId: 'receipt-1', currentVersionId: 'version-1' };
  });
  return {
    service: new TruthStoreService(db as never, audit as never, { ingest, confirmCandidate } as never),
    audit, ingest, confirmCandidate,
  };
}

describe('brand-neutral truth store generic-pipeline adapter policy', () => {
  it('routes a valid notification through Observation → Candidate → Truth without a direct Truth write', async () => {
    const { service, audit, ingest, confirmCandidate } = fixture();
    const result = await service.confirmMobileReceipt('user-1', receipt as never);

    expect(ingest).toHaveBeenCalledWith('user-1', expect.objectContaining({
      sourceMode: 'NOTIFICATION', providerKey: 'com.example.bank', externalEventKey: 'receipt-1',
      parserKey: 'mobile-notification-billing.v1', resourceHint: 'finance.transaction',
      payload: { subjectKey: 'receipt-1', amountMinor: 12345, currency: 'CNY' },
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      observedAt: '2026-09-04T00:00:01.000Z', occurredAt: '2026-09-04T00:00:00.000Z',
    }));
    expect(confirmCandidate).toHaveBeenCalledWith('user-1', 'candidate-1', {
      sourceReceiptId: 'receipt-1', verifiedBy: 'user_confirmation',
      verificationMethod: 'user_confirmation_after_device_key_proof',
    });
    expect(JSON.stringify(ingest.mock.calls[0]?.[1])).not.toMatch(/通知正文/);
    expect(result).toMatchObject({ resourceKey: 'mobile.billing.transaction', status: 'verified' });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRUTH_RECORD_VERIFIED', result: 'success', resourceId: 'truth-1' }));
  });

  it('does not emit a verified audit when observation ingestion fails', async () => {
    const { service, audit, ingest, confirmCandidate } = fixture({ ingestError: new Error('observation write failed') });
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow('observation write failed');
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(confirmCandidate).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('fails closed when normalization produces no candidate', async () => {
    const { service, audit, confirmCandidate } = fixture({ noCandidate: true });
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow('produced no candidate fact');
    expect(confirmCandidate).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('treats a double-click/API retry with a complete Truth as idempotent without re-ingestion', async () => {
    const { service, audit, ingest, confirmCandidate } = fixture({ existing: completedTruthRecord() });
    const result = await service.confirmMobileReceipt('user-1', receipt as never);
    expect(result).toMatchObject({ id: 'truth-existing', currentVersionId: 'version-existing' });
    expect(ingest).not.toHaveBeenCalled();
    expect(confirmCandidate).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('does not emit a verified audit when candidate confirmation fails', async () => {
    const { service, audit, ingest, confirmCandidate } = fixture({ confirmError: new Error('truth confirmation failed') });
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow('truth confirmation failed');
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(confirmCandidate).toHaveBeenCalledTimes(1);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('fails closed on an existing half-record with no current fact version', async () => {
    const { service, ingest } = fixture({ existing: completedTruthRecord({ currentVersionId: null }) });
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow('incomplete and cannot be consumed');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('refuses unknown or malformed notification candidates before pipeline ingestion', async () => {
    const { service, ingest } = fixture();
    await expect(service.confirmMobileReceipt('user-1', { ...receipt, amountMinor: null, snapshotJson: { ...receipt.snapshotJson, candidateKind: 'unknown', candidateResource: null, currency: null } } as never)).rejects.toThrow('cannot become a verified fact');
    expect(ingest).not.toHaveBeenCalled();
  });
});
