import { describe, expect, it, vi } from 'vitest';
import { truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { TruthStoreService } from '../src/truth-store/truth-store.service';

const receipt = {
  id: 'receipt-1', userId: 'user-1', payloadHash: 'a'.repeat(64), amountMinor: 12345, postedAt: new Date('2026-09-04T00:00:00.000Z'),
  snapshotJson: { schema: 'mobile-notification-minimal-v2', candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 70, currency: 'CNY', parserVersion: 'generic-notification-v1' },
};

function completedTruthRecord(overrides: Record<string, unknown> = {}) {
  return { id: 'truth-existing', userId: 'user-1', resourceKey: 'mobile.billing.transaction', subjectKey: 'receipt-1', status: 'verified', currentVersionId: 'version-existing', sourceReceiptId: 'receipt-1', verifiedBy: 'user_confirmation', verifiedAt: new Date('2026-09-04T00:01:00.000Z'), revokedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function fixture(options: { selects?: unknown[][]; truthError?: unknown; versionError?: unknown; updateError?: unknown } = {}) {
  const selects = [...(options.selects ?? [[], []])];
  const truthValues = vi.fn(async () => { if (options.truthError) throw options.truthError; });
  const versionValues = vi.fn(async () => { if (options.versionError) throw options.versionError; });
  const updateWhere = vi.fn(async () => { if (options.updateError) throw options.updateError; });
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => selects.shift() ?? []) })) })) }));
  const insert = vi.fn((table: unknown) => ({ values: table === truthRecords ? truthValues : table === truthRecordVersions ? versionValues : vi.fn() }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }));
  const tx = { select, insert, update };
  const transaction = vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx));
  const db = { ...tx, transaction };
  const audit = { append: vi.fn(async () => undefined) };
  return { service: new TruthStoreService(db as never, audit as never), truthValues, versionValues, updateWhere, transaction, audit };
}

describe('brand-neutral truth store policy', () => {
  it('writes a record, its immutable version, and currentVersionId in one transaction without provider data or notification text', async () => {
    const { service, truthValues, versionValues, updateWhere, transaction, audit } = fixture();
    const result = await service.confirmMobileReceipt('user-1', receipt as never);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(truthValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', resourceKey: 'mobile.billing.transaction', sourceReceiptId: 'receipt-1', verifiedBy: 'user_confirmation', status: 'verified', currentVersionId: null }));
    expect(versionValues).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 1, verificationMethod: 'user_confirmation_after_device_key_proof', valueJson: { resource: 'mobile.billing.transaction', amountMinor: 12345, currency: 'CNY', occurredAt: '2026-09-04T00:00:00.000Z' }, valueHash: expect.stringMatching(/^[a-f0-9]{64}$/), evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(versionValues.mock.calls[0][0])).not.toMatch(/com\.example|通知正文|provider/i);
    expect(result).toMatchObject({ resourceKey: 'mobile.billing.transaction', status: 'verified' });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRUTH_RECORD_VERIFIED', result: 'success' }));
  });

  it.each([
    ['the version insert fails', { versionError: new Error('version write failed') }],
    ['the current-version update fails', { updateError: new Error('pointer update failed') }],
  ])('does not emit a verified audit when %s and lets the transaction roll back', async (_label, options) => {
    const { service, transaction, audit } = fixture(options);
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow(/write failed|update failed/);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('treats a double-click/API retry that already has a complete record as idempotent without starting a transaction', async () => {
    const { service, transaction, audit } = fixture({ selects: [[completedTruthRecord()]] });
    const result = await service.confirmMobileReceipt('user-1', receipt as never);
    expect(result).toMatchObject({ id: 'truth-existing', currentVersionId: 'version-existing' });
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('returns a completed competing record after a duplicate-key race instead of producing a second version', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    const { service, transaction, audit } = fixture({ selects: [[], [], [completedTruthRecord()]], truthError: duplicate });
    const result = await service.confirmMobileReceipt('user-1', receipt as never);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'truth-existing', currentVersionId: 'version-existing' });
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('fails closed on an existing half-record with no current fact version', async () => {
    const { service, transaction } = fixture({ selects: [[completedTruthRecord({ currentVersionId: null })]] });
    await expect(service.confirmMobileReceipt('user-1', receipt as never)).rejects.toThrow('incomplete and cannot be consumed');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses unknown or malformed notification candidates before opening a transaction', async () => {
    const { service, truthValues, transaction } = fixture();
    await expect(service.confirmMobileReceipt('user-1', { ...receipt, amountMinor: null, snapshotJson: { ...receipt.snapshotJson, candidateKind: 'unknown', candidateResource: null, currency: null } } as never)).rejects.toThrow('cannot become a verified fact');
    expect(truthValues).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
