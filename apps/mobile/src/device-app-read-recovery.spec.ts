import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  discoverLaunchableApps: vi.fn(), openApp: vi.fn(),
  getAppReadSessionStatus: vi.fn(), startAppReadSession: vi.fn(), stopAppReadSession: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: { LazyArmorDeviceBridge: native } }));
import { startNativeAppReadSession, type NativeAppReadSessionStatus } from './device-app-bridge';

const field = 'com.miui.calculator:id/result';
const consent = { version: 'ui-read.v1' as const, requestedFields: [field], sourceVersion: '2026-10-09T17:00:00.000Z' };
let expiry: number;
function session(patch: Partial<NativeAppReadSessionStatus> = {}): NativeAppReadSessionStatus {
  return { accountId: 'owner', active: true, sessionId: 'original-session', targetPackage: 'com.miui.calculator',
    modes: ['UI_READ'], requestedFields: [field], sourceVersion: consent.sourceVersion, status: 'WAITING_FOREGROUND',
    expiresAt: expiry, usageAccessGranted: true, observerPermissionGranted: true, observerConnected: true,
    foregroundPackage: 'com.lazyarmor.app', pendingEventCount: 3, ...patch };
}
const start = (scope = consent, expires = expiry) => startNativeAppReadSession('owner', 'original-session', 'com.miui.calculator', ['UI_READ'], new Date(expires).toISOString(), scope);

describe('native scope recovery after a lost enqueue response', () => {
  beforeEach(() => {
    vi.resetAllMocks(); expiry = Date.now() + 60_000;
    native.getAppReadSessionStatus.mockResolvedValue(session());
    // The existing native API rejects starting a second active session.
    native.startAppReadSession.mockRejectedValue(new Error('SESSION_ALREADY_ACTIVE'));
  });
  it('resumes the same live confirmation without restarting native or clearing queued evidence', async () => {
    const retained = session(); native.getAppReadSessionStatus.mockResolvedValue(retained);
    expect(await start()).toBe(true);
    expect(await start()).toBe(true);
    expect(native.startAppReadSession).not.toHaveBeenCalled();
    expect(native.stopAppReadSession).not.toHaveBeenCalled();
    expect(retained).toEqual(session());
  });
  it('also preserves an in-flight foreground read and refuses an expiry extension', async () => {
    native.getAppReadSessionStatus.mockResolvedValue(session({ status: 'READING', foregroundPackage: 'com.miui.calculator' }));
    expect(await start()).toBe(true);
    expect(await start(consent, expiry + 60_000)).toBe(false);
    native.getAppReadSessionStatus.mockResolvedValue(session({ status: 'READING', foregroundPackage: 'another.app' }));
    expect(await start()).toBe(false);
    expect(native.startAppReadSession).not.toHaveBeenCalled();
  });
  it('does not replace a different account, session, App, source, mode or field scope', async () => {
    for (const patch of [{ accountId: 'other-owner' }, { sessionId: 'other-session' }, { targetPackage: 'another.app' },
      { sourceVersion: 'new-source' }, { modes: ['SHARE'] }, { requestedFields: ['another-field'] }]) {
      native.getAppReadSessionStatus.mockResolvedValue(session(patch));
      expect(await start()).toBe(false);
    }
    expect(await start({ ...consent, requestedFields: [field, field] })).toBe(false);
    expect(native.startAppReadSession).not.toHaveBeenCalled();
    expect(native.stopAppReadSession).not.toHaveBeenCalled();
  });
  it('requires current independent permission, observer health and a valid deadline', async () => {
    for (const patch of [{ usageAccessGranted: false }, { observerPermissionGranted: false }, { observerConnected: false },
      { status: 'CANCELLED' }, { expiresAt: Date.now() - 1 }]) {
      native.getAppReadSessionStatus.mockResolvedValue(session(patch)); expect(await start()).toBe(false);
    }
    expect(await start(consent, Date.now() - 1)).toBe(false);
    expect(native.startAppReadSession).not.toHaveBeenCalled();
  });
  it('starts a new native scope only when no active scope exists, and fails closed on status errors', async () => {
    native.getAppReadSessionStatus.mockResolvedValue({ active: false }); native.startAppReadSession.mockResolvedValue(true);
    expect(await start()).toBe(true);
    expect(native.startAppReadSession).toHaveBeenCalledWith('owner', 'original-session', 'com.miui.calculator', ['UI_READ'], expiry, [field], consent.sourceVersion);
    native.startAppReadSession.mockClear(); native.getAppReadSessionStatus.mockRejectedValue(new Error('native unavailable'));
    expect(await start()).toBe(false); expect(native.startAppReadSession).not.toHaveBeenCalled();
  });
});
