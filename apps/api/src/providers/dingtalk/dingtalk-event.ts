import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import type { JsonValue } from '@lazy-armor/plan-schema';

// DingTalk event authentication and normalization. Both HTTP_CALLBACK and the
// long-connection STREAM transport collapse into one ProviderEventEnvelope so a
// single dedupe -> normalize -> RealityPipeline path exists for every event.
export type DingTalkEventTransport = 'HTTP_CALLBACK' | 'STREAM';
export interface DingTalkEventEnvelope {
  transport: DingTalkEventTransport;
  eventId: string;
  eventType: string;
  corpId: string;
  resource: Record<string, JsonValue>;
  payloadSizeBytes: number;
  payloadHash: string;
}

export function verifyDingTalkEventSignature(input: { rawBody?: Buffer; signature?: unknown; timestamp?: unknown; appSecret?: string }) {
  const { rawBody, signature, timestamp, appSecret } = input;
  if (!appSecret || appSecret.length < 8 || !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 1048576
    || typeof signature !== 'string' || signature.length < 8 || signature.length > 512
    || typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp)) {
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const expected = createHmac('sha256', appSecret).update(`${timestamp}\n${appSecret}`).digest();
  const provided = Buffer.from(signature, 'base64');
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { payloadHash: createHash('sha256').update(rawBody).digest('hex') };
}

const denied = (): never => { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : denied();

export type DingTalkEventResult =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event'; event: DingTalkEventEnvelope };

function normalizeMessageEvent(payload: Record<string, unknown>, transport: DingTalkEventTransport, payloadSizeBytes: number, payloadHash: string): DingTalkEventResult {
  const corpId = payload.corpId; const eventId = payload.msgId ?? payload.messageId ?? payload.eventId;
  const eventType = typeof payload.EventType === 'string' ? payload.EventType : payload.eventType;
  const messageId = eventId; const userId = payload.userId ?? payload.senderId; const content = payload.content;
  const createAt = payload.createAt ?? payload.createdAt ?? payload.timestamp;
  if (typeof messageId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(messageId)
    || typeof corpId !== 'string' || !corpId || typeof eventType !== 'string' || !eventType
    || typeof userId !== 'string' || typeof content !== 'string'
    || (typeof createAt !== 'string' && typeof createAt !== 'number')) return denied();
  const updatedAt = typeof createAt === 'string' && Number.isFinite(Date.parse(createAt)) ? new Date(createAt).toISOString()
    : new Date((createAt as number) * 1000).toISOString();
  const resource = { resourceType: eventType === 'check_url' ? 'DingTalkMessage' : 'DingTalkMessage', resourceId: messageId, corpId,
    userId, content, updatedAt };
  return { type: 'event', event: { transport, eventId: messageId, eventType, corpId, resource, payloadSizeBytes, payloadHash } };
}

export function parseDingTalkEvent(input: { rawBody?: Buffer; signature?: unknown; timestamp?: unknown; appSecret?: string }): DingTalkEventResult {
  if (!Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0 || input.rawBody.length > 1048576) return denied();
  const text = input.rawBody!.toString('utf8');
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { return denied(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return denied();
  const payload = parsed as Record<string, unknown>;
  // check_url challenge carries no signed payload (DingTalk registers the callback URL).
  if (payload.EventType === 'check_url') {
    const challenge = payload.Random;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(challenge)) return denied();
    return { type: 'url_verification', challenge };
  }
  const { payloadHash } = verifyDingTalkEventSignature({ rawBody: input.rawBody, signature: input.signature, timestamp: input.timestamp, appSecret: input.appSecret });
  const body = object(payload);
  if (body.EventType === 'message' || body.eventType === 'message') return normalizeMessageEvent(body, 'HTTP_CALLBACK', input.rawBody!.length, payloadHash);
  if (body.EventType === 'workNotification' || body.eventType === 'workNotification') {
    const corpId = body.corpId; const messageId = body.msgId ?? body.messageId;
    const createAt = body.createAt ?? body.createdAt ?? body.timestamp;
    if (typeof messageId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(messageId) || typeof corpId !== 'string' || !corpId
      || typeof body.userId !== 'string' || typeof body.content !== 'string' || (typeof createAt !== 'string' && typeof createAt !== 'number')) return denied();
    const updatedAt = typeof createAt === 'string' && Number.isFinite(Date.parse(createAt)) ? new Date(createAt).toISOString()
      : new Date((createAt as number) * 1000).toISOString();
    return { type: 'event', event: { transport: 'HTTP_CALLBACK', eventId: messageId, eventType: 'workNotification', corpId,
      resource: { resourceType: 'DingTalkWorkNotification', resourceId: messageId, corpId, userId: body.userId, content: body.content, updatedAt },
      payloadSizeBytes: input.rawBody!.length, payloadHash } };
  }
  return denied();
}

// STREAM records are already authenticated by the long-connection channel and
// normalized into the exact same envelope as HTTP callbacks.
export function parseDingTalkStreamEvent(record: Record<string, unknown>): DingTalkEventResult {
  const body = object(record);
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (body.EventType === 'message' || body.eventType === 'message') return normalizeMessageEvent(body, 'STREAM', JSON.stringify(body).length, payloadHash);
  if (body.EventType === 'workNotification' || body.eventType === 'workNotification') {
    const corpId = body.corpId; const messageId = body.msgId ?? body.messageId;
    const createAt = body.createAt ?? body.createdAt ?? body.timestamp;
    if (typeof messageId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(messageId) || typeof corpId !== 'string' || !corpId
      || typeof body.userId !== 'string' || typeof body.content !== 'string' || (typeof createAt !== 'string' && typeof createAt !== 'number')) return denied();
    const updatedAt = typeof createAt === 'string' && Number.isFinite(Date.parse(createAt)) ? new Date(createAt).toISOString()
      : new Date((createAt as number) * 1000).toISOString();
    return { type: 'event', event: { transport: 'STREAM', eventId: messageId, eventType: 'workNotification', corpId,
      resource: { resourceType: 'DingTalkWorkNotification', resourceId: messageId, corpId, userId: body.userId, content: body.content, updatedAt },
      payloadSizeBytes: JSON.stringify(body).length, payloadHash } };
  }
  return denied();
}
