import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { trustedDeviceRequestSessions, trustedDevices } from '@lazy-armor/database';
import { TrustedDevicesService } from '../src/trusted-devices/trusted-devices.service';

const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeySpki = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const publicKeyFingerprint = createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex');
const expiresAt = new Date(Date.now() + 60_000);
const challenge = { id: 'challenge-1', userId: 'user-1', deviceId: 'device-1', keyId: 'android-keystore-key', publicKeySpki, publicKeyFingerprint, nonce: 'a'.repeat(64), expiresAt, consumedAt: null, createdAt: new Date() };

function fixture() {
  let selected = 0;
  let trusted: Record<string, unknown> | null = null;
  const challengeUpdate = vi.fn(async () => undefined);
  const deviceUpdate = vi.fn(async () => undefined);
  const connectionUpdate = vi.fn(async () => undefined);
  const trustedInsert = vi.fn(async (value: Record<string, unknown>) => { trusted = value; });
  const sessionInsert = vi.fn(async () => undefined);
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => {
      selected += 1;
      if (selected === 1) return [challenge];
      if (selected === 2) return [];
      return trusted ? [trusted] : [];
    }) })) })) })),
    insert: vi.fn((table: unknown) => ({ values: table === trustedDevices ? trustedInsert : table === trustedDeviceRequestSessions ? sessionInsert : vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn((values: Record<string, unknown>) => ({ where: vi.fn(async () => {
      if ('consumedAt' in values) await challengeUpdate(values);
      else if ('status' in values) await deviceUpdate(values);
      else await connectionUpdate(values);
    }) })) })),
  };
  const audit = { append: vi.fn(async () => undefined) };
  return { service: new TrustedDevicesService(db as never, audit as never), audit, trustedInsert, sessionInsert, challengeUpdate, deviceUpdate, connectionUpdate };
}

describe('trusted device proof policy', () => {
  it('activates a device only after a valid signature over the server-defined one-time payload', async () => {
    const { service, trustedInsert, sessionInsert, challengeUpdate, audit } = fixture();
    const payload = `lazy-armor-device-proof-v1|${challenge.id}|${challenge.nonce}|${challenge.expiresAt.toISOString()}|${challenge.publicKeyFingerprint}`;
    const signature = sign('sha256', Buffer.from(payload, 'utf8'), keyPair.privateKey).toString('base64');
    const response = await service.verifyChallenge('user-1', challenge.id, { signature });
    expect(challengeUpdate).toHaveBeenCalledWith(expect.objectContaining({ consumedAt: expect.any(Date) }));
    expect(trustedInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', deviceId: 'device-1', publicKeyFingerprint, trustLevel: 'key_proven', status: 'active' }));
    expect(sessionInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', trustedDeviceId: expect.any(String), expiresAt: expect.any(Date), revokedAt: null }));
    expect(response).toMatchObject({ deviceId: 'device-1', status: 'active', trustLevel: 'key_proven', deviceSession: { id: expect.any(String), expiresAt: expect.any(String) } });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRUSTED_DEVICE_PROOF_VERIFIED', result: 'success' }));
  });

  it('rejects a public key fingerprint that does not match the supplied DER key', async () => {
    const { service } = fixture();
    await expect(service.issueChallenge('user-1', { deviceId: 'device-1', keyId: 'android-keystore-key', publicKeySpki, publicKeyFingerprint: '0'.repeat(64) })).rejects.toThrow('fingerprint mismatch');
  });

  it('rejects an invalid signature and writes a blocked audit result', async () => {
    const { service, audit } = fixture();
    await expect(service.verifyChallenge('user-1', challenge.id, { signature: Buffer.from('not-a-valid-proof').toString('base64') })).rejects.toThrow('proof is invalid');
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRUSTED_DEVICE_PROOF_REJECTED', result: 'blocked', reasonCode: 'INVALID_SIGNATURE' }));
  });
});


describe('trusted device signed request envelope', () => {
  function requestFixture(options: { proofError?: unknown; sessionExpiresAt?: Date } = {}) {
    const now = new Date();
    const session = { id: 'session-1', userId: 'user-1', trustedDeviceId: 'trusted-device-1', expiresAt: options.sessionExpiresAt ?? new Date(now.getTime() + 60_000), revokedAt: null, createdAt: now };
    const device = { id: 'trusted-device-1', userId: 'user-1', deviceId: 'device-1', keyId: 'android-keystore-key', publicKeySpki, publicKeyFingerprint, trustLevel: 'key_proven', status: 'active', lastProvedAt: now, revokedAt: null, createdAt: now, updatedAt: now };
    const proofValues = vi.fn(async () => { if (options.proofError) throw options.proofError; });
    const db = {
      select: vi.fn(() => ({ from: vi.fn((table: unknown) => ({ where: vi.fn(() => ({ limit: vi.fn(async () => table === trustedDeviceRequestSessions ? [session] : [device]) })) })) })),
      insert: vi.fn(() => ({ values: proofValues })),
    };
    const audit = { append: vi.fn(async () => undefined) };
    return { service: new TrustedDevicesService(db as never, audit as never), proofValues };
  }

  function envelope(payload: Record<string, unknown>, overrides: Partial<Record<string, string>> = {}) {
    const sessionId = 'session-1';
    const requestId = 'f'.repeat(64);
    const signedAt = overrides.signedAt ?? new Date().toISOString();
    const payloadHash = overrides.payloadHash ?? createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const signedPayload = `lazy-armor-device-request-v1|${sessionId}|${requestId}|POST|/device-app-connections|${payloadHash}|${signedAt}`;
    return { sessionId, requestId, signedAt, payloadHash, signature: sign('sha256', Buffer.from(signedPayload, 'utf8'), keyPair.privateKey).toString('base64') };
  }

  it('accepts a fresh request only when the active device key signs the exact endpoint and body hash', async () => {
    const input = { packageName: 'com.example.app', discoveryFingerprint: 'a'.repeat(64) };
    const { service, proofValues } = requestFixture();
    await expect(service.assertSignedRequest('user-1', envelope(input), 'POST', '/device-app-connections', input)).resolves.toMatchObject({ trustedDeviceId: 'trusted-device-1', deviceId: 'device-1', sessionId: 'session-1' });
    expect(proofValues).toHaveBeenCalledWith(expect.objectContaining({ trustedDeviceSessionId: 'session-1', requestId: 'f'.repeat(64), requestPath: '/device-app-connections', payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it('fails closed when the request body changes after the Keystore signature was produced', async () => {
    const { service } = requestFixture();
    await expect(service.assertSignedRequest('user-1', envelope({ enabled: true }), 'POST', '/device-app-connections', { enabled: false })).rejects.toThrow('payload hash mismatch');
  });

  it('rejects stale signed requests before accepting source data', async () => {
    const input = { packageName: 'com.example.app' };
    const { service } = requestFixture();
    const oldSignedAt = new Date(Date.now() - 91_000).toISOString();
    await expect(service.assertSignedRequest('user-1', envelope(input, { signedAt: oldSignedAt }), 'POST', '/device-app-connections', input)).rejects.toThrow('invalid or stale');
  });

  it('rejects a replayed request ID recorded for the same short-lived device session', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    const input = { packageName: 'com.example.app' };
    const { service } = requestFixture({ proofError: duplicate });
    await expect(service.assertSignedRequest('user-1', envelope(input), 'POST', '/device-app-connections', input)).rejects.toThrow('already processed');
  });
});
