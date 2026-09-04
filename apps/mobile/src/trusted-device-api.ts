import { api } from './api';
import { signTrustedDeviceChallenge, trustedDeviceIdentity } from './device-app-bridge';
import { deviceInstallationId } from './device-installation-id';

interface TrustedDeviceChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
  payload: string;
}

export interface TrustedDevice {
  id: string;
  deviceId: string;
  keyId: string;
  publicKeyFingerprint: string;
  trustLevel: string;
  status: 'active' | 'revoked';
  lastProvedAt: string;
}

export async function ensureTrustedDevice(token: string | null): Promise<TrustedDevice> {
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await trustedDeviceIdentity();
  if (!identity) throw new Error('DEVICE_KEY_UNAVAILABLE');
  const deviceId = await deviceInstallationId();
  const challenge = await api<TrustedDeviceChallenge>('/trusted-devices/challenges', token, {
    method: 'POST',
    body: JSON.stringify({ deviceId, keyId: identity.keyId, publicKeySpki: identity.publicKeySpki, publicKeyFingerprint: identity.publicKeyFingerprint }),
  });
  if (!challenge.challengeId || !challenge.nonce || !challenge.payload || new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error('DEVICE_CHALLENGE_INVALID');
  const signature = await signTrustedDeviceChallenge(challenge.payload);
  if (!signature) throw new Error('DEVICE_PROOF_UNAVAILABLE');
  return api<TrustedDevice>(`/trusted-devices/challenges/${challenge.challengeId}/verify`, token, { method: 'POST', body: JSON.stringify({ signature }) });
}
