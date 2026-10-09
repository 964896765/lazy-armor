import { createHash, createECDH, createPrivateKey } from 'node:crypto';

/** Shared native verifier identity; calendar and read tickets keep distinct schemas. */
export function nativeDispatchSigningKey(secret: string) {
  const seed = createHash('sha256').update('native-device-dispatch-v1:' + secret).digest();
  const ec = createECDH('prime256v1'); ec.setPrivateKey(seed);
  const bytes = ec.getPublicKey();
  return createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: seed.toString('base64url'), x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url') } });
}
