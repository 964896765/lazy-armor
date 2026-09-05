import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  deviceInstallationId: vi.fn(async () => 'device-1'),
  trustedDeviceIdentity: vi.fn(async () => ({ keyId: 'key-1', publicKeySpki: 'spki', publicKeyFingerprint: 'a'.repeat(64) })),
  signTrustedDeviceChallenge: vi.fn(async () => 'signature'),
  createTrustedDeviceRequestEnvelope: vi.fn(),
}));

vi.mock('./api', () => ({ api: mocks.api }));
vi.mock('./device-installation-id', () => ({ deviceInstallationId: mocks.deviceInstallationId }));
vi.mock('./device-app-bridge', () => ({
  trustedDeviceIdentity: mocks.trustedDeviceIdentity,
  signTrustedDeviceChallenge: mocks.signTrustedDeviceChallenge,
  createTrustedDeviceRequestEnvelope: mocks.createTrustedDeviceRequestEnvelope,
}));

import { clearTrustedDeviceSession, ensureTrustedDevice } from './trusted-device-api';

describe('trusted device session cache isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearTrustedDeviceSession();
    let enrollment = 0;
    mocks.api.mockImplementation(async (path: string) => {
      if (path === '/trusted-devices/challenges') return { challengeId: `challenge-${enrollment + 1}`, nonce: 'nonce', payload: 'payload', expiresAt: new Date(Date.now() + 60_000).toISOString() };
      enrollment += 1;
      return { id: 'trusted-device-1', deviceId: 'device-1', keyId: 'key-1', publicKeyFingerprint: 'a'.repeat(64), trustLevel: 'key_proven', status: 'active', lastProvedAt: new Date().toISOString(), deviceSession: { id: `session-${enrollment}`, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    });
  });

  it('reuses a session only for the same access token', async () => {
    await ensureTrustedDevice('token-a');
    await ensureTrustedDevice('token-a');
    expect(mocks.api).toHaveBeenCalledTimes(2);

    await ensureTrustedDevice('token-b');
    expect(mocks.api).toHaveBeenCalledTimes(4);
  });

  it('forces a fresh proof when recovering a revoked device connection', async () => {
    await ensureTrustedDevice('token-a');
    await ensureTrustedDevice('token-a', { force: true });
    expect(mocks.api).toHaveBeenCalledTimes(4);
    expect(mocks.signTrustedDeviceChallenge).toHaveBeenCalledTimes(2);
  });
});
