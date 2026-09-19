import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_\-.:]+$/);
const isoDate = z.string().datetime({ offset: true });
const idList = z.array(identifier).max(20);

const calendarEvent = z.object({ kind: z.literal('calendar'), calendarId: identifier, summary: z.string().min(1).max(512),
  startAt: isoDate, endAt: isoDate, eventId: identifier.optional() }).strict();
const messageAction = z.object({ kind: z.literal('message'), touser: identifier, text: z.string().min(1).max(4000) }).strict();
const approvalAction = z.object({ kind: z.literal('approval'), creatorUserid: identifier, templateId: identifier,
  formValues: z.record(z.string().min(1).max(200), z.string().min(1).max(4000)).refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 50) }).strict();
const wecomActionSchema = z.discriminatedUnion('kind', [messageAction, calendarEvent, approvalAction]);
export type WeComAction = z.infer<typeof wecomActionSchema>;

const KIND_FOR_CAPABILITY: Record<string, 'message' | 'calendar' | 'approval'> = {
  WECOM_APP_MESSAGE_SEND: 'message', WECOM_CALENDAR_CREATE: 'calendar', WECOM_CALENDAR_UPDATE: 'calendar',
  WECOM_APPROVAL_PREPARE: 'approval',
};

export function prepareWeComAction(input: Record<string, unknown>, capability: string, key: string | undefined) {
  const expectedKind = KIND_FOR_CAPABILITY[capability];
  const parsed = wecomActionSchema.safeParse((input.context as Record<string, unknown> | undefined)?.wecomAction);
  if (!parsed.success || !expectedKind || !/^[a-f0-9]{64}$/.test(key ?? '') || parsed.data.kind !== expectedKind)
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const data = parsed.data;
  if (capability === 'WECOM_CALENDAR_CREATE' && data.kind === 'calendar' && data.eventId !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (capability === 'WECOM_CALENDAR_UPDATE' && data.kind === 'calendar' && data.eventId === undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (data.kind === 'calendar' && Date.parse(data.endAt) <= Date.parse(data.startAt)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...data, operationKey: key! };
}

const wecomResourceKinds = ['WeComMessage', 'WeComApproval'] as const;
export type WeComResourceKind = typeof wecomResourceKinds[number];

export function normalizeWeComResource(raw: Record<string, unknown>, kind: WeComResourceKind, corpId: string) {
  if (!wecomResourceKinds.includes(kind)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const resourceId = raw.resourceId ?? raw.msgId ?? raw.msgid ?? raw.spNo ?? raw.sp_no;
  const updatedAt = raw.updatedAt ?? raw.updateTime ?? raw.update_time ?? raw.createTime ?? raw.create_time;
  if (typeof resourceId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(resourceId)
    || typeof corpId !== 'string' || !corpId || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const value = { resourceType: kind, resourceId, corpId, updatedAt: new Date(updatedAt).toISOString(), ...raw };
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return value;
}

export function normalizeWeComCalendarEvent(raw: Record<string, unknown>, calendarId: string) {
  const eventId = raw.schedule_id ?? raw.scheduleId ?? raw.eventId ?? raw.event_id;
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const toIso = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const epoch = Number(value);
    if (/^\d{9,13}$/.test(value) && Number.isFinite(epoch)) return new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString();
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  };
  const start = (raw.start ?? raw.start_time ?? {}) as Record<string, unknown>;
  const end = (raw.end ?? raw.end_time ?? {}) as Record<string, unknown>;
  const startAt = toIso(start.dateTime ?? start.date_time ?? start.timestamp) ?? toIso(raw.start_time);
  const endAt = toIso(end.dateTime ?? end.date_time ?? end.timestamp) ?? toIso(raw.end_time);
  const status = raw.status === 'CANCELLED' || raw.status === 'cancelled' ? 'cancelled' : raw.status === 'TENTATIVE' ? 'tentative' : 'confirmed';
  const updatedAt = toIso(raw.update_time ?? raw.updateTime) ?? startAt;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(eventId) || !startAt || !endAt || !updatedAt)
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return { eventId, calendarId, title: summary, start: { dateTime: startAt }, end: { dateTime: endAt },
    attendees: idList.parse(raw.attendees ?? []), status, etag: raw.etag ?? eventId, updatedAt };
}

export function wecomWriteEvidence(actual: Record<string, unknown>, desired: ReturnType<typeof prepareWeComAction>, capability: string) {
  let expected: unknown; let actualFields: unknown; let resourceId = '';
  if (desired.kind === 'message') {
    resourceId = String(actual.msgId ?? actual.msgid ?? '');
    expected = { text: desired.text };
    actualFields = { text: extractText(actual) };
  } else if (desired.kind === 'calendar') {
    resourceId = String(actual.schedule_id ?? actual.scheduleId ?? actual.eventId ?? '');
    const normalized = normalizeWeComCalendarEvent(actual, desired.calendarId);
    expected = { calendarId: desired.calendarId, title: desired.summary, startAt: new Date(desired.startAt).toISOString(), endAt: new Date(desired.endAt).toISOString() };
    actualFields = { calendarId: normalized.calendarId, title: normalized.title, startAt: normalized.start.dateTime, endAt: normalized.end.dateTime };
  } else {
    resourceId = String(actual.spNo ?? actual.sp_no ?? '');
    expected = { templateId: desired.templateId, formValues: desired.formValues };
    actualFields = { templateId: String(actual.templateId ?? actual.template_id ?? ''), formValues: actual.formValues ?? {} };
  }
  const matched = resourceId.length > 0 && providerDefinitionHash(actualFields) === providerDefinitionHash(expected);
  return { matched, resourceId, capability, expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(actualFields) };
}

function extractText(actual: Record<string, unknown>): string {
  if (typeof actual.content === 'string') return actual.content;
  if (typeof actual.text === 'string') return actual.text;
  const text = (actual.text ?? actual.content) as Record<string, unknown> | undefined;
  if (text && typeof text === 'object' && typeof text.content === 'string') return text.content;
  return '';
}
