import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MobileNotificationReceiptsService } from '../src/device-apps/mobile-notification-receipts.service';

const now = new Date();
const connection = {
  id: 'connection-1', userId: 'user-1', packageName: 'com.example.localbank', enabled: 1, modesJson: ['open_app', 'notification_read'],
};
const event = {
  eventId: 'a'.repeat(64), contentHash: 'b'.repeat(64), sourcePackage: 'com.example.localbank', postedAt: now.toISOString(), capturedAt: now.toISOString(), hasTitle: true, hasText: true,
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
  return { service: new MobileNotificationReceiptsService(db as never, audit as never, limiter as never, notifications as never, telemetry as never), values, audit, limiter, notifications, telemetry };
}

describe('generic mobile notification receipt policy', () => {
  it('records only minimal generic evidence from a user-authorized app source', async () => {
    const { service, values, notifications, telemetry } = fixture();
    const response = await service.receive('user-1', 'connection-1', event);
    expect(response).toMatchObject({ duplicate: false, status: 'received_unclassified' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', deviceAppConnectionId: 'connection-1', eventId: event.eventId, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), sourcePackage: 'com.example.localbank', amountMinor: null, status: 'received_unclassified',
      snapshotJson: { schema: 'mobile-notification-minimal-v1', hasTitle: true, hasText: true },
    }));
    expect(JSON.stringify(values.mock.calls[0][0])).not.toContain(event.contentHash);
    expect(notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ title: '收到一条待核实的应用通知', actionRequired: false }));
    expect(telemetry.increment).toHaveBeenCalledWith('mobile_notification.received', 1, { source: 'generic', status: 'unclassified' });
  });

  it('rejects an app source that the user has not separately enabled', async () => {
    const { service, values, audit, limiter } = fixture([[{ ...connection, modesJson: ['open_app'] }]]);
    await expect(service.receive('user-1', 'connection-1', event)).rejects.toThrow('not authorized');
    expect(values).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', result: 'blocked', reasonCode: 'SOURCE_NOT_AUTHORIZED' }));
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
