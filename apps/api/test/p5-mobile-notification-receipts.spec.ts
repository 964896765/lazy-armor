import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MobileNotificationReceiptsService } from '../src/device-apps/mobile-notification-receipts.service';

const now = new Date();
const connection = {
  id: 'connection-1', userId: 'user-1', deviceId: 'device-1', trustedDeviceId: 'trusted-device-1', packageName: 'com.example.localbank', enabled: 1, modesJson: ['open_app', 'notification_read'],
};
const event = {
  eventId: 'a'.repeat(64), contentHash: 'b'.repeat(64), sourcePackage: 'com.example.localbank', postedAt: now.toISOString(), capturedAt: now.toISOString(), hasTitle: true, hasText: true, candidateKind: 'unknown' as const, candidateResource: null, candidateConfidence: 0, amountMinor: null, currency: null, parserVersion: 'generic-notification-v1' as const,
};

function fixture(results: unknown[][] = [[connection], []]) {
  let call = 0;
  const values = vi.fn(async () => undefined);
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => results[call++] ?? []) })) })) })),
    insert: vi.fn(() => ({ values })),
  };
  const audit = { append: vi.fn(async () => undefined) };
  const limiter = { consume: vi.fn(async () => ({ allowed: true })) };
  const notifications = { emit: vi.fn(async () => undefined) };
  const telemetry = { increment: vi.fn() };
  const trustedDevices = { assertActive: vi.fn(async () => ({ id: 'trusted-device-1', deviceId: 'device-1', trustLevel: 'key_proven', status: 'active' })) };
  const truthStore = { confirmMobileReceipt: vi.fn(async () => ({ id: 'truth-1', resourceKey: 'mobile.billing.transaction', status: 'verified' })) };
  return { service: new MobileNotificationReceiptsService(db as never, audit as never, limiter as never, notifications as never, telemetry as never, trustedDevices as never, truthStore as never), values, audit, limiter, notifications, telemetry, trustedDevices, truthStore };
}

describe('generic mobile notification receipt policy', () => {
  it('records only minimal generic evidence from a user-authorized app source', async () => {
    const { service, values, notifications, telemetry, trustedDevices } = fixture();
    const response = await service.receive('user-1', 'connection-1', event);
    expect(response).toMatchObject({ duplicate: false, status: 'received_unclassified' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', deviceAppConnectionId: 'connection-1', eventId: event.eventId, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), sourcePackage: 'com.example.localbank', amountMinor: null, status: 'received_unclassified',
      snapshotJson: { schema: 'mobile-notification-minimal-v2', hasTitle: true, hasText: true, candidateKind: 'unknown', candidateResource: null, candidateConfidence: 0, currency: null, parserVersion: 'generic-notification-v1' },
    }));
    expect(JSON.stringify(values.mock.calls[0][0])).not.toContain(event.contentHash);
    expect(notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ title: '收到一条待核实的应用通知', actionRequired: false }));
    expect(telemetry.increment).toHaveBeenCalledWith('mobile_notification.received', 1, { source: 'generic', status: 'unclassified' });
    expect(trustedDevices.assertActive).toHaveBeenCalledWith('user-1', 'trusted-device-1', 'device-1');
  });

  it('rejects an app source that the user has not separately enabled', async () => {
    const { service, values, audit, limiter } = fixture([[{ ...connection, modesJson: ['open_app'] }]]);
    await expect(service.receive('user-1', 'connection-1', event)).rejects.toThrow('not authorized');
    expect(values).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', result: 'blocked', reasonCode: 'SOURCE_NOT_AUTHORIZED' }));
  });

  it('rejects a receipt when the bound trusted device is no longer active', async () => {
    const { service, values, audit, limiter, trustedDevices } = fixture();
    trustedDevices.assertActive.mockRejectedValueOnce(new Error('Device is not currently trusted'));
    await expect(service.receive('user-1', 'connection-1', event)).rejects.toThrow('not currently trusted');
    expect(values).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', result: 'blocked', reasonCode: 'TRUSTED_DEVICE_NOT_ACTIVE' }));
  });

  it('rejects an incoherent candidate before persistence instead of trusting a client supplied resource', async () => {
    const { service, values, audit, limiter } = fixture();
    await expect(service.receive('user-1', 'connection-1', { ...event, candidateKind: 'billing_transaction_candidate', candidateResource: 'mobile.billing.transaction', candidateConfidence: 70, amountMinor: null, currency: 'CNY' })).rejects.toThrow('not a valid generic normalized signal');
    expect(values).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', result: 'blocked', reasonCode: 'INVALID_NORMALIZED_CANDIDATE' }));
  });

  it('rejects a stale capture before persistence and records the reason without notification content', async () => {
    const { service, values, audit, limiter } = fixture();
    await expect(service.receive('user-1', 'connection-1', { ...event, capturedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() })).rejects.toThrow('outside the accepted time window');
    expect(values).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', result: 'blocked', reasonCode: 'STALE_EVENT' }));
  });

  it('treats an identical event as a duplicate and does not emit a second user message', async () => {
    const payloadHash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const { service, values, notifications, telemetry } = fixture([[connection], [{ id: 'receipt-1', payloadHash, status: 'received_unclassified' }]]);
    await expect(service.receive('user-1', 'connection-1', event)).resolves.toEqual({ receiptId: 'receipt-1', duplicate: true, status: 'received_unclassified' });
    expect(values).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(telemetry.increment).toHaveBeenCalledWith('mobile_notification.duplicate', 1, { source: 'generic' });
  });
});
