import { describe, expect, it } from 'vitest';
import { appReadSessionStatusForEvent, canTransitionAppReadSession, isExactAndroidPackage } from '../src/app-read-session';

describe('AppReadSession deterministic state contract', () => {
  it('allows the reviewed acquisition lifecycle', () => {
    expect(appReadSessionStatusForEvent('CREATED', 'SESSION_STARTED')).toBe('WAITING_FOREGROUND');
    expect(appReadSessionStatusForEvent('WAITING_FOREGROUND', 'FOREGROUND_CONFIRMED')).toBe('READING');
    expect(appReadSessionStatusForEvent('READING', 'HEARTBEAT')).toBe('READING');
    expect(appReadSessionStatusForEvent('READING', 'FOREGROUND_LOST')).toBe('APP_LEFT_FOREGROUND');
  });

  it('keeps terminal sessions closed and rejects impossible transitions', () => {
    expect(appReadSessionStatusForEvent('TIMEOUT', 'FOREGROUND_CONFIRMED')).toBe('TIMEOUT');
    expect(canTransitionAppReadSession('CREATED', 'READING')).toBe(false);
    expect(() => appReadSessionStatusForEvent('CREATED', 'FOREGROUND_CONFIRMED')).toThrow(/Invalid/);
  });

  it('accepts exact Android package names only', () => {
    expect(isExactAndroidPackage('com.example.app')).toBe(true);
    expect(isExactAndroidPackage('com.example.*')).toBe(false);
    expect(isExactAndroidPackage('example')).toBe(false);
  });
});
