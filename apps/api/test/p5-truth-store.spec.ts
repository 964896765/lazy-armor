import { describe, expect, it, vi } from 'vitest';
import { truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { TruthStoreService } from '../src/truth-store/truth-store.service';

const receipt = {
  id: 'receipt-1', userId: 'user-1', payloadHash: 'a'.repeat(64), amountMinor: 12345, postedAt: new Date('2026-09-04T00:00:00.000Z'),
  snapshotJson: { schema: 'mobile-notification-minimal-v2', candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 70, currency: 'CNY', parserVersion: 'generic-notification-v1' },
};

function fixture() {
  const truthValues = vi.fn(async () => undefined);
  const versionValues = vi.fn(async () => undefined);
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
    insert: vi.fn((table: unknown) => ({ values: table === truthRecords ? truthValues : table === truthRecordVersions ? versionValues : vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };
  const audit = { append: vi.fn(async () => undefined) };
  return { service: new TruthStoreService(db as never, audit as never), truthValues, versionValues, audit };
}

describe('brand-neutral truth store policy', () => {
  it('writes an immutable, user-confirmed mobile billing fact without a provider name or notification body', async () => {
    const { service, truthValues, versionValues, audit } = fixture();
    const result = await service.confirmMobileReceipt('user-1', receipt as never);
    expect(truthValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', resourceKey: 'mobile.billing.transaction', sourceReceiptId: 'receipt-1', verifiedBy: 'user_confirmation', status: 'verified' }));
    expect(versionValues).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 1, verificationMethod: 'user_confirmation_after_device_key_proof', valueJson: { resource: 'mobile.billing.transaction', amountMinor: 12345, currency: 'CNY', occurredAt: '2026-09-04T00:00:00.000Z' }, valueHash: expect.stringMatching(/^[a-f0-9]{64}$/), evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(versionValues.mock.calls[0][0])).not.toMatch(/com\.example|通知正文|provider/i);
    expect(result).toMatchObject({ resourceKey: 'mobile.billing.transaction', status: 'verified' });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRUTH_RECORD_VERIFIED', result: 'success' }));
  });

  it('refuses unknown or malformed notification candidates before creating a truth record', async () => {
    const { service, truthValues } = fixture();
    await expect(service.confirmMobileReceipt('user-1', { ...receipt, amountMinor: null, snapshotJson: { ...receipt.snapshotJson, candidateKind: 'unknown', candidateResource: null, currency: null } } as never)).rejects.toThrow('cannot become a verified fact');
    expect(truthValues).not.toHaveBeenCalled();
  });
});
