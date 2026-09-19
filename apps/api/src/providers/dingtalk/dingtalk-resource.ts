import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_\-.:]+$/);
const isoDate = z.string().datetime({ offset: true });
const idList = z.array(identifier).max(20);
const nonEmptyIdList = z.array(identifier).min(1).max(20);

const calendarEvent = z.object({ kind: z.literal('calendar'), calendarId: identifier, summary: z.string().min(1).max(512),
  startAt: isoDate, endAt: isoDate, eventId: identifier.optional() }).strict();
const messageAction = z.object({ kind: z.literal('message'), receiveId: identifier, robotCode: identifier, text: z.string().min(1).max(4000) }).strict();
const dingAction = z.object({ kind: z.literal('ding'), userIds: nonEmptyIdList, text: z.string().min(1).max(4000) }).strict();
const approvalAction = z.object({ kind: z.literal('approval'), originatorUserId: identifier, processCode: identifier,
  formValues: z.record(z.string().min(1).max(200), z.string().min(1).max(4000)).refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 50) }).strict();
const dingtalkActionSchema = z.discriminatedUnion('kind', [messageAction, calendarEvent, dingAction, approvalAction]);
export type DingTalkAction = z.infer<typeof dingtalkActionSchema>;

const KIND_FOR_CAPABILITY: Record<string, 'message' | 'calendar' | 'ding' | 'approval'> = {
  DINGTALK_MESSAGE_SEND: 'message', DINGTALK_CALENDAR_CREATE: 'calendar', DINGTALK_CALENDAR_UPDATE: 'calendar',
  DINGTALK_DING_SEND: 'ding', DINGTALK_APPROVAL_PREPARE: 'approval',
};

export function prepareDingTalkAction(input: Record<string, unknown>, capability: string, key: string | undefined) {
  const expectedKind = KIND_FOR_CAPABILITY[capability];
  const parsed = dingtalkActionSchema.safeParse((input.context as Record<string, unknown> | undefined)?.dingtalkAction);
  if (!parsed.success || !expectedKind || !/^[a-f0-9]{64}$/.test(key ?? '') || parsed.data.kind !== expectedKind)
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const data = parsed.data;
  if (capability === 'DINGTALK_CALENDAR_CREATE' && data.kind === 'calendar' && data.eventId !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (capability === 'DINGTALK_CALENDAR_UPDATE' && data.kind === 'calendar' && data.eventId === undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (data.kind === 'calendar' && Date.parse(data.endAt) <= Date.parse(data.startAt)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...data, operationKey: key! };
}

const dingtalkResourceKinds = ['DingTalkMessage', 'DingTalkApproval', 'DingTalkWorkNotification', 'DingTalkDing'] as const;
export type DingTalkResourceKind = typeof dingtalkResourceKinds[number];

export function normalizeDingTalkResource(raw: Record<string, unknown>, kind: DingTalkResourceKind, corpId: string) {
  if (!dingtalkResourceKinds.includes(kind)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const resourceId = raw.resourceId ?? raw.messageId ?? raw.msgId ?? raw.instanceId ?? raw.processInstanceId ?? raw.dingId;
  const updatedAt = raw.updatedAt ?? raw.updateTime ?? raw.updatedTime ?? raw.createTime ?? raw.createdTime ?? raw.createAt;
  if (typeof resourceId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(resourceId)
    || typeof corpId !== 'string' || !corpId || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const value = { resourceType: kind, resourceId, corpId, updatedAt: new Date(updatedAt).toISOString(), ...raw };
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return value;
}

export function normalizeDingTalkCalendarEvent(raw: Record<string, unknown>, calendarId: string) {
  const eventId = raw.id ?? raw.eventId ?? raw.event_id;
  const start = (raw.start ?? raw.startTime ?? {}) as Record<string, unknown>;
  const end = (raw.end ?? raw.endTime ?? {}) as Record<string, unknown>;
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const status = raw.status === 'cancelled' ? 'cancelled' : raw.status === 'tentative' ? 'tentative' : 'confirmed';
  const toIso = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const epoch = Number(value);
    if (/^\d{9,13}$/.test(value) && Number.isFinite(epoch)) return new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString();
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  };
  const startAt = toIso(start.dateTime ?? start.date_time);
  const endAt = toIso(end.dateTime ?? end.date_time);
  const updatedAt = toIso(raw.updatedTime ?? raw.updated_time) ?? toIso(raw.createdTime ?? raw.created_time) ?? startAt;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(eventId) || !startAt || !endAt || !updatedAt)
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return { eventId, calendarId, title: summary, start: { dateTime: startAt }, end: { dateTime: endAt },
    attendees: idList.parse(raw.attendees ?? []), status, etag: raw.etag ?? eventId, updatedAt };
}

export function dingtalkWriteEvidence(actual: Record<string, unknown>, desired: ReturnType<typeof prepareDingTalkAction>, capability: string) {
  let expected: unknown; let actualFields: unknown; let resourceId = '';
  if (desired.kind === 'message') {
    resourceId = String(actual.messageId ?? actual.msgId ?? actual.msg_id ?? '');
    expected = { text: desired.text };
    actualFields = { text: extractText(actual) };
  } else if (desired.kind === 'calendar') {
    resourceId = String(actual.eventId ?? actual.id ?? actual.event_id ?? '');
    const normalized = normalizeDingTalkCalendarEvent(actual, desired.calendarId);
    expected = { calendarId: desired.calendarId, title: desired.summary, startAt: new Date(desired.startAt).toISOString(), endAt: new Date(desired.endAt).toISOString() };
    actualFields = { calendarId: normalized.calendarId, title: normalized.title, startAt: normalized.start.dateTime, endAt: normalized.end.dateTime };
  } else if (desired.kind === 'ding') {
    resourceId = String(actual.dingId ?? actual.ding_id ?? '');
    expected = { text: desired.text };
    actualFields = { text: extractText(actual) };
  } else {
    resourceId = String(actual.instanceId ?? actual.processInstanceId ?? actual.instance_id ?? '');
    expected = { processCode: desired.processCode, formValues: desired.formValues };
    actualFields = { processCode: String(actual.processCode ?? actual.process_code ?? ''), formValues: actual.formValues ?? {} };
  }
  const matched = resourceId.length > 0 && providerDefinitionHash(actualFields) === providerDefinitionHash(expected);
  return { matched, resourceId, capability, expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(actualFields) };
}

function extractText(actual: Record<string, unknown>): string {
  if (typeof actual.content === 'string') return actual.content;
  if (typeof actual.text === 'string') return actual.text;
  if (typeof actual.msgParam === 'string') { try { return String(JSON.parse(actual.msgParam).content ?? ''); } catch { return ''; } }
  return '';
}
