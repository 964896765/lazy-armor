import { api } from './api';
import { createTrustedDeviceRequestEnvelope, signTrustedDeviceChallenge, trustedDeviceIdentity } from './device-app-bridge';
import { deviceInstallationId } from './device-installation-id';

interface TrustedDeviceChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
  payload: string;
}

export interface TrustedDeviceSession {
  id: string;
  expiresAt: string;
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

type EnrolledTrustedDevice = TrustedDevice & { deviceSession: TrustedDeviceSession };
let activeSession: EnrolledTrustedDevice | null = null;

export async function ensureTrustedDevice(token: string | null): Promise<EnrolledTrustedDevice> {
  if (!token) throw new Error('AUTH_REQUIRED');
  const deviceId = await deviceInstallationId();
  if (activeSession?.deviceId === deviceId && activeSession.status === 'active' && Date.parse(activeSession.deviceSession.expiresAt) - Date.now() > 30_000) return activeSession;
  const identity = await trustedDeviceIdentity();
  if (!identity) throw new Error('DEVICE_KEY_UNAVAILABLE');
  const challenge = await api<TrustedDeviceChallenge>('/trusted-devices/challenges', token, {
    method: 'POST',
    body: JSON.stringify({ deviceId, keyId: identity.keyId, publicKeySpki: identity.publicKeySpki, publicKeyFingerprint: identity.publicKeyFingerprint }),
  });
  if (!challenge.challengeId || !challenge.nonce || !challenge.payload || new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error('DEVICE_CHALLENGE_INVALID');
  const signature = await signTrustedDeviceChallenge(challenge.payload);
  if (!signature) throw new Error('DEVICE_PROOF_UNAVAILABLE');
  const enrolled = await api<EnrolledTrustedDevice>(`/trusted-devices/challenges/${challenge.challengeId}/verify`, token, { method: 'POST', body: JSON.stringify({ signature }) });
  if (enrolled.status !== 'active' || !enrolled.deviceSession?.id || Date.parse(enrolled.deviceSession.expiresAt) <= Date.now()) throw new Error('DEVICE_SESSION_INVALID');
  activeSession = enrolled;
  return enrolled;
}

export async function deviceBoundApi<T>(path: string, token: string | null, init: RequestInit) {
  if (!token) throw new Error('AUTH_REQUIRED');
  if (init.method !== 'POST' || typeof init.body !== 'string') throw new Error('DEVICE_REQUEST_BODY_REQUIRED');
  const device = await ensureTrustedDevice(token);
  const envelope = await createTrustedDeviceRequestEnvelope(device.deviceSession.id, 'POST', path, init.body);
  if (!envelope) throw new Error('DEVICE_REQUEST_PROOF_UNAVAILABLE');
  return api<T>(path, token, {
    ...init,
    headers: {
      ...init.headers,
      'x-device-session': device.deviceSession.id,
      'x-device-request-id': envelope.requestId,
      'x-device-signed-at': envelope.signedAt,
      'x-device-payload-hash': envelope.payloadHash,
      'x-device-signature': envelope.signature,
    },
  });
}

export function clearTrustedDeviceSession() { activeSession = null; }
