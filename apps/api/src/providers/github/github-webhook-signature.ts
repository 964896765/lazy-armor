import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';

// Authentication primitive only; the future HTTP adapter must still validate
// active connection, repository ID and event schema before publishing Observation.
// Delivery headers are not signed: payloadHash must also participate in dedupe.
export function verifyGitHubWebhookSignature(input: { rawBody?: Buffer; signature?: unknown; deliveryId?: unknown; secret?: string }) {
  const { rawBody, signature, deliveryId, secret } = input;
  if (!secret || secret.length < 32 || !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 1048576
    || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)
    || typeof deliveryId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deliveryId)) {
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  const actual = Buffer.from(signature.slice(7), 'hex'); const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (!timingSafeEqual(expected, actual)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { deliveryId: deliveryId.toLowerCase(), payloadHash: createHash('sha256').update(rawBody).digest('hex') };
}
