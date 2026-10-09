import { appReadSessionStatus, drainAppReadSessionEvents, acknowledgeAppReadSessionEvents, createTrustedDeviceRequestId } from './device-app-bridge';
import { useAuthStore } from './auth-store';
import { deviceBoundApi } from './trusted-device-api';

/** This single claimed read may finish while its explicitly selected target App is foreground. */
export async function publishNativeReadHeartbeat(sessionId: string, packageName: string) {
  const token = useAuthStore.getState().token;
  const status = await appReadSessionStatus();
  if (!token || !status.active || status.sessionId !== sessionId || status.targetPackage !== packageName || status.foregroundPackage !== packageName || status.status !== 'READING') return false;
  const eventKey = await createTrustedDeviceRequestId();
  if (!eventKey) return false;
  try {
    await deviceBoundApi('/app-read-sessions/' + sessionId + '/heartbeat', token, { method: 'POST', body: JSON.stringify({ eventKey, foregroundPackage: packageName, usageAccessGranted: status.usageAccessGranted, nativeStatus: 'READING', observedAt: new Date().toISOString() }) });
    if (useAuthStore.getState().token !== token) return false;
    const events = await drainAppReadSessionEvents();
    // Heartbeat supersedes queued start/foreground-only events, never content captures.
    await acknowledgeAppReadSessionEvents(events.filter(event => event.sessionId === sessionId && ['SESSION_STARTED', 'FOREGROUND_CONFIRMED', 'HEARTBEAT'].includes(event.eventType)).map(event => event.eventKey));
    return true;
  } catch { return false; }
}
