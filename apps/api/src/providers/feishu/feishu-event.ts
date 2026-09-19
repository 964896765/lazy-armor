import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import type { JsonValue } from '@lazy-armor/plan-schema';

// Feishu event authentication primitive. Only identifiers survive as a hint:
// the signed body is authenticated, then normalized into a FeishuMessage resource
// for the existing Reality Pipeline. Never triggers Plan execution directly.
export function verifyFeishuEventSignature(input: { rawBody?: Buffer; signature?: unknown; encryptKey?: string }) {
  const { rawBody, signature, encryptKey } = input;
  if (!encryptKey || encryptKey.length < 16 || !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 1048576
    || typeof signature !== 'string' || !/^\d{10,13},[a-f0-9]{16,64},[a-f0-9]{64}$/i.test(signature)) {
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  const [timestamp, nonce, provided] = signature.split(',');
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const expected = createHmac('sha256', encryptKey).update(`${timestamp}${nonce}${encryptKey}${rawBody.toString('utf8')}`).digest();
  const actual = Buffer.from(provided, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { payloadHash: createHash('sha256').update(rawBody).digest('hex') };
}

const denied = (): never => { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : denied();

export type FeishuEventResult =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event'; eventId: string; eventType: string; tenantKey: string; resource: Record<string, JsonValue>; payloadSizeBytes: number; payloadHash: string };

export function parseFeishuEvent(input: { rawBody?: Buffer; encryptKey?: string; signature?: unknown }): FeishuEventResult {
  if (!Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0 || input.rawBody.length > 1048576) return denied();
  const text = input.rawBody!.toString('utf8');
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { return denied(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return denied();
  const payload = parsed as Record<string, unknown>;
  // URL verification handshake has no X-Lark-Signature header.
  if (payload.type === 'url_verification') {
    const challenge = payload.challenge;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(challenge) || typeof payload.token !== 'string') return denied();
    return { type: 'url_verification', challenge };
  }
  const { payloadHash } = verifyFeishuEventSignature({ rawBody: input.rawBody, signature: input.signature, encryptKey: input.encryptKey });
  if (payload.schema !== '2.0') return denied();
  const header = object(payload.header); const event = object(payload.event);
  const eventId = header.event_id; const eventType = header.event_type; const tenantKey = header.tenant_key;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_\-]{1,200}$/.test(eventId) || eventType !== 'im.message.receive_v1'
    || typeof tenantKey !== 'string' || !tenantKey) return denied();
  const message = object(event.message);
  const messageId = message.message_id; const chatId = message.chat_id; const msgType = message.msg_type; const content = message.content;
  const sender = object(event.sender);
  const senderIdValue = sender.sender_id;
  const senderId = senderIdValue && typeof senderIdValue === 'object' && !Array.isArray(senderIdValue)
    ? (senderIdValue as Record<string, unknown>).open_id : senderIdValue;
  const createTime = message.create_time ?? header.create_time;
  if (typeof messageId !== 'string' || !/^[A-Za-z0-9_\-]{1,200}$/.test(messageId) || typeof chatId !== 'string'
    || typeof msgType !== 'string' || typeof content !== 'string' || typeof senderId !== 'string'
    || (typeof createTime !== 'string' && typeof createTime !== 'number')) return denied();
  const updatedAt = typeof createTime === 'string' && Number.isFinite(Date.parse(createTime)) ? new Date(createTime).toISOString()
    : new Date((createTime as number) * 1000).toISOString();
  return { type: 'event', eventId, eventType, tenantKey,
    resource: { resourceType: 'FeishuMessage', resourceId: messageId, tenantKey, chatId, senderId, msgType, content, updatedAt },
    payloadSizeBytes: input.rawBody!.length, payloadHash };
}
