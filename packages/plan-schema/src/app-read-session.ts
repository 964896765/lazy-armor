export const APP_READ_SESSION_MODES = ['NOTIFICATION', 'SHARE'] as const;
export const APP_READ_SESSION_STATUSES = [
  'CREATED', 'WAITING_FOREGROUND', 'READING', 'TIMEOUT', 'APP_LEFT_FOREGROUND', 'CANCELLED', 'FAILED',
] as const;
export const APP_READ_SESSION_EVENT_TYPES = [
  'SESSION_STARTED', 'FOREGROUND_CONFIRMED', 'HEARTBEAT', 'NOTIFICATION_CAPTURED', 'SHARE_CAPTURED',
  'FOREGROUND_LOST', 'SESSION_STOPPED', 'SESSION_TIMED_OUT', 'NATIVE_ERROR',
] as const;

export type AppReadSessionMode = typeof APP_READ_SESSION_MODES[number];
export type AppReadSessionStatus = typeof APP_READ_SESSION_STATUSES[number];
export type AppReadSessionEventType = typeof APP_READ_SESSION_EVENT_TYPES[number];

export const APP_READ_SESSION_MAX_SECONDS = 15 * 60;
export const APP_READ_SESSION_HEARTBEAT_GRACE_SECONDS = 45;
export const APP_READ_SESSION_TERMINAL_STATUSES = new Set<AppReadSessionStatus>([
  'TIMEOUT', 'APP_LEFT_FOREGROUND', 'CANCELLED', 'FAILED',
]);

const transitions: Record<AppReadSessionStatus, ReadonlySet<AppReadSessionStatus>> = {
  CREATED: new Set(['WAITING_FOREGROUND', 'CANCELLED', 'FAILED', 'TIMEOUT']),
  WAITING_FOREGROUND: new Set(['READING', 'APP_LEFT_FOREGROUND', 'CANCELLED', 'FAILED', 'TIMEOUT']),
  READING: new Set(['APP_LEFT_FOREGROUND', 'CANCELLED', 'FAILED', 'TIMEOUT']),
  TIMEOUT: new Set(), APP_LEFT_FOREGROUND: new Set(), CANCELLED: new Set(), FAILED: new Set(),
};

export function canTransitionAppReadSession(from: AppReadSessionStatus, to: AppReadSessionStatus) {
  return from === to || transitions[from].has(to);
}

export function appReadSessionStatusForEvent(current: AppReadSessionStatus, event: AppReadSessionEventType): AppReadSessionStatus {
  if (APP_READ_SESSION_TERMINAL_STATUSES.has(current)) return current;
  const desired: Partial<Record<AppReadSessionEventType, AppReadSessionStatus>> = {
    SESSION_STARTED: 'WAITING_FOREGROUND', FOREGROUND_CONFIRMED: 'READING', FOREGROUND_LOST: 'APP_LEFT_FOREGROUND',
    SESSION_STOPPED: 'CANCELLED', SESSION_TIMED_OUT: 'TIMEOUT', NATIVE_ERROR: 'FAILED',
  };
  const next = desired[event] ?? current;
  if (!canTransitionAppReadSession(current, next)) throw new Error('Invalid AppReadSession transition ' + current + ' -> ' + next);
  return next;
}

export function isExactAndroidPackage(value: string) {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value);
}
