import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => {
      selected += 1;
      if (selected === 1) return [challenge];
      if (selected === 2) return [];
      return trusted ? [trusted] : [];
    }) })) })) })),
    insert: vi.fn((table: unknown) => ({ values: table ? trustedInsert : trustedInsert })),
    update: vi.fn(() => ({ set: vi.fn((values: Record<string, unknown>) => ({ where: vi.fn(async () => {
      if ('consumedAt' in values) await challengeUpdate(values);
      else if ('status' in values) await deviceUpdate(values);
      else await connectionUpdate(values);
    }) })) })),
  };
  const audit = { append: vi.fn(async () => undefined) };
  return { service: new TrustedDevicesService(db as never, audit as never), audit, trustedInsert, challengeUpdate, deviceUpdate, connectionUpdate };
}

describe('trusted device proof policy', () => {
  it('activates a device only after a valid signature over the server-defined one-time payload', async () => {
    const { service, trustedInsert, challengeUpdate, audit } = fixture();
    const payload = `lazy-armor-device-proof-v1|${challenge.id}|${challenge.nonce}|${challenge.expiresAt.toISOString()}|${challenge.publicKeyFingerprint}`;
    const signature = sign('sha256', Buffer.from(payload, 'utf8'), keyPair.privateKey).toString('base64');
    const response = await service.verifyChallenge('user-1', challenge.id, { signature });
    expect(challengeUpdate).toHaveBeenCalledWith(expect.objectContaining({ consumedAt: expect.any(Date) }));
    expect(trustedInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', deviceId: 'device-1', publicKeyFingerprint, trustLevel: 'key_proven', status: 'active' }));
    expect(response).toMatchObject({ deviceId: 'device-1', status: 'active', trustLevel: 'key_proven' });
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
