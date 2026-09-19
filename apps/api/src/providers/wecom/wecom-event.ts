import { createHash, timingSafeEqual } from 'node:crypto';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import type { JsonValue } from '@lazy-armor/plan-schema';

// WeCom callback authentication and normalization. The callback token plus
// timestamp/nonce are folded into one SHA-1 signature check; the plaintext
// echostr challenge and JSON event payload are normalized into the Reality
// Pipeline without a second event processing path.
export interface WeComEventEnvelope {
  eventId: string;
  eventType: string;
  corpId: string;
  resource: Record<string, JsonValue>;
  payloadSizeBytes: number;
  payloadHash: string;
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

function verifySignature(input: { token?: string; timestamp?: unknown; nonce?: unknown; signature?: unknown; payload?: string }) {
  const { token, timestamp, nonce, signature, payload } = input;
  if (!token || token.length < 8 || typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp)
    || typeof nonce !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(nonce)
    || typeof signature !== 'string' || !/^[a-f0-9]{40}$/i.test(signature)
    || typeof payload !== 'string' || !payload || payload.length > 1048576) {
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  const ts = Number(timestamp); const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const expected = sha1([token, timestamp, nonce, payload].sort().join(''));
  const provided = Buffer.from(signature, 'hex'); const expectedBuffer = Buffer.from(expected, 'hex');
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(expectedBuffer, provided)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
}

export function verifyWeComChallenge(input: { token?: string; timestamp?: unknown; nonce?: unknown; signature?: unknown; echostr?: unknown }) {
  const echostr = input.echostr;
  if (typeof echostr !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(echostr)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  verifySignature({ token: input.token, timestamp: input.timestamp, nonce: input.nonce, signature: input.signature, payload: echostr });
  return { challenge: echostr };
}

const denied = (): never => { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); };

export type WeComEventResult = { type: 'event'; event: WeComEventEnvelope };

export function parseWeComEvent(input: { rawBody?: Buffer; signature?: unknown; timestamp?: unknown; nonce?: unknown; token?: string }): WeComEventResult {
  if (!Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0 || input.rawBody.length > 1048576) return denied();
  const text = input.rawBody!.toString('utf8');
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { return denied(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return denied();
  const payload = parsed as Record<string, unknown>;
  verifySignature({ token: input.token, timestamp: input.timestamp, nonce: input.nonce, signature: input.signature, payload: text });
  const msgId = payload.MsgId ?? payload.msgId ?? payload.msgid;
  const corpId = payload.ToUserName ?? payload.corpId;
  const fromUser = payload.FromUserName ?? payload.fromUser;
  const createTime = payload.CreateTime ?? payload.createTime;
  const content = payload.Content ?? payload.content;
  const msgType = payload.MsgType ?? payload.msgType;
  if (typeof msgId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(msgId)
    || typeof corpId !== 'string' || !corpId || msgType !== 'text'
    || typeof fromUser !== 'string' || typeof content !== 'string'
    || (typeof createTime !== 'string' && typeof createTime !== 'number')) return denied();
  const updatedAt = typeof createTime === 'string' && Number.isFinite(Date.parse(createTime)) ? new Date(createTime).toISOString()
    : new Date((createTime as number) * 1000).toISOString();
  const resource = { resourceType: 'WeComMessage', resourceId: msgId, corpId, fromUser, content, updatedAt };
  return { type: 'event', event: { eventId: msgId, eventType: 'app_message', corpId, resource,
    payloadSizeBytes: input.rawBody!.length, payloadHash: createHash('sha256').update(input.rawBody!).digest('hex') } };
}
