import { describe, expect, it } from 'vitest';
import { appReadEventRequest, appReadHeartbeatRequest } from './app-read-session-api-contract';

const base = {
  sessionId: 'session-1', eventKey: 'a'.repeat(64), packageName: 'com.example.app',
  observedAt: Date.now(), payload: {},
};

describe('AppReadSession mobile API contract', () => {
  it('maps a foreground-bound capture without raw content', () => {
    const request = appReadEventRequest({
      ...base, eventType: 'NOTIFICATION_CAPTURED', evidenceHash: 'b'.repeat(64),
      candidateKind: 'billing_transaction_candidate', amountMinor: 25800, currency: 'CNY',
      payload: { hasText: true, parserVersion: 'generic-notification-v1' },
    });
    expect(request).toMatchObject({ eventType: 'NOTIFICATION_CAPTURED', amountMinor: 25800, currency: 'CNY' });
    expect(JSON.stringify(request)).not.toContain('通知正文');
  });

  it('requires deterministic heartbeat evidence', () => {
    expect(appReadHeartbeatRequest({
      ...base, eventType: 'HEARTBEAT',
      payload: { foregroundPackage: 'com.example.app', nativeStatus: 'READING', usageAccessGranted: true },
    })).toMatchObject({ nativeStatus: 'READING', usageAccessGranted: true });
    expect(appReadHeartbeatRequest({ ...base, eventType: 'HEARTBEAT' })).toBeNull();
  });
});
