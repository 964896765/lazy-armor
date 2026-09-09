import type { NativeAppReadSessionEvent } from './device-app-bridge';

const LIFECYCLE_EVENTS = new Set([
  'SESSION_STARTED', 'FOREGROUND_CONFIRMED', 'NOTIFICATION_CAPTURED', 'SHARE_CAPTURED',
  'FOREGROUND_LOST', 'SESSION_STOPPED', 'SESSION_TIMED_OUT', 'NATIVE_ERROR',
]);

export function appReadEventRequest(event: NativeAppReadSessionEvent) {
  if (!LIFECYCLE_EVENTS.has(event.eventType) || !Number.isFinite(event.observedAt)) return null;
  return {
    eventKey: event.eventKey,
    eventType: event.eventType,
    packageName: event.packageName,
    observedAt: new Date(event.observedAt).toISOString(),
    payload: event.payload,
    ...(event.evidenceHash ? { evidenceHash: event.evidenceHash } : {}),
    ...(event.candidateKind ? { candidateKind: event.candidateKind } : {}),
    ...(Number.isSafeInteger(event.amountMinor) ? { amountMinor: event.amountMinor } : {}),
    ...(event.currency ? { currency: event.currency } : {}),
  };
}

export function appReadHeartbeatRequest(event: NativeAppReadSessionEvent) {
  if (event.eventType !== 'HEARTBEAT' || !Number.isFinite(event.observedAt)) return null;
  const foregroundPackage = event.payload.foregroundPackage;
  const nativeStatus = event.payload.nativeStatus;
  const usageAccessGranted = event.payload.usageAccessGranted;
  if (typeof foregroundPackage !== 'string' || (nativeStatus !== 'WAITING_FOREGROUND' && nativeStatus !== 'READING') || typeof usageAccessGranted !== 'boolean') return null;
  return {
    eventKey: event.eventKey,
    foregroundPackage,
    nativeStatus,
    usageAccessGranted,
    observedAt: new Date(event.observedAt).toISOString(),
  };
}
