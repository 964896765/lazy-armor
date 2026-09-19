import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_\-.:]+$/);
const isoDate = z.string().datetime({ offset: true });
const idList = z.array(identifier).max(20);

const calendarEvent = z.object({ kind: z.literal('calendar'), calendarId: identifier, summary: z.string().min(1).max(512),
  startAt: isoDate, endAt: isoDate, eventId: identifier.optional() }).strict();
const messageAction = z.object({ kind: z.literal('message'), receiveId: identifier, msgType: z.literal('text'), text: z.string().min(1).max(4000) }).strict();
const docAppend = z.object({ kind: z.literal('doc'), documentId: identifier, blockId: identifier, text: z.string().min(1).max(4000) }).strict();
const sheetAppend = z.object({ kind: z.literal('sheet'), spreadsheetToken: identifier, range: z.string().min(1).max(100), values: z.array(z.array(z.string().max(1000)).min(1).max(100)).min(1).max(100) }).strict();
const bitableCreate = z.object({ kind: z.literal('bitable'), appToken: identifier, tableId: identifier, fields: z.record(z.string().min(1).max(200), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 50) }).strict();
const feishuActionSchema = z.discriminatedUnion('kind', [messageAction, calendarEvent, docAppend, sheetAppend, bitableCreate]);
export type FeishuAction = z.infer<typeof feishuActionSchema>;

const KIND_FOR_CAPABILITY: Record<string, 'message' | 'calendar' | 'doc' | 'sheet' | 'bitable'> = {
  FEISHU_MESSAGE_SEND: 'message', FEISHU_CALENDAR_CREATE: 'calendar', FEISHU_CALENDAR_UPDATE: 'calendar',
  FEISHU_DOC_APPEND: 'doc', FEISHU_SHEET_APPEND: 'sheet', FEISHU_BITABLE_RECORD_CREATE: 'bitable',
};

export function prepareFeishuAction(input: Record<string, unknown>, capability: string, key: string | undefined) {
  const expectedKind = KIND_FOR_CAPABILITY[capability];
  const parsed = feishuActionSchema.safeParse((input.context as Record<string, unknown> | undefined)?.feishuAction);
  if (!parsed.success || !expectedKind || !/^[a-f0-9]{64}$/.test(key ?? '') || parsed.data.kind !== expectedKind)
    throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const data = parsed.data;
  if (capability === 'FEISHU_CALENDAR_CREATE' && data.kind === 'calendar' && data.eventId !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (capability === 'FEISHU_CALENDAR_UPDATE' && data.kind === 'calendar' && data.eventId === undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (data.kind === 'calendar' && Date.parse(data.endAt) <= Date.parse(data.startAt)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...data, operationKey: key! };
}

const feishuResourceKinds = ['FeishuMessage', 'FeishuDoc', 'FeishuSheet', 'FeishuBitable', 'FeishuApproval'] as const;
export type FeishuResourceKind = typeof feishuResourceKinds[number];

export function normalizeFeishuResource(raw: Record<string, unknown>, kind: FeishuResourceKind, tenantKey: string) {
  if (!feishuResourceKinds.includes(kind)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const resourceId = raw.resourceId ?? raw.messageId ?? raw.documentId ?? raw.spreadsheetToken ?? raw.appToken ?? raw.instanceCode;
  const updatedAt = raw.updatedAt ?? raw.updateTime ?? raw.createTime;
  if (typeof resourceId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(resourceId)
    || typeof tenantKey !== 'string' || !tenantKey || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const value = { resourceType: kind, resourceId, tenantKey, updatedAt: new Date(updatedAt).toISOString(), ...raw };
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return value;
}

export function normalizeFeishuCalendarEvent(raw: Record<string, unknown>, calendarId: string) {
  const eventId = raw.event_id; const start = raw.start_time as Record<string, unknown> | undefined;
  const end = raw.end_time as Record<string, unknown> | undefined;
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const status = raw.status === 'cancelled' ? 'cancelled' : raw.status === 'tentative' ? 'tentative' : 'confirmed';
  const toIso = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const epoch = Number(value);
    if (/^\d{9,13}$/.test(value) && Number.isFinite(epoch)) return new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString();
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  };
  const startAt = start ? toIso(start.timestamp) : undefined;
  const endAt = end ? toIso(end.timestamp) : undefined;
  const updatedAt = toIso(raw.update_time) ?? startAt;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(eventId) || !startAt || !endAt || !updatedAt)
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return { eventId, calendarId, title: summary, start: { dateTime: startAt }, end: { dateTime: endAt },
    attendees: idList.parse(raw.attendees ?? []), status, etag: raw.etag ?? eventId, updatedAt };
}

export function feishuWriteEvidence(actual: Record<string, unknown>, desired: ReturnType<typeof prepareFeishuAction>, capability: string) {
  let expected: unknown; let actualFields: unknown; let resourceId = '';
  if (desired.kind === 'message') {
    resourceId = String(actual.messageId ?? actual.message_id ?? '');
    const rawContent = actual.content;
    let text = '';
    if (typeof rawContent === 'string') { try { text = String(JSON.parse(rawContent).text ?? ''); } catch { text = rawContent; } }
    expected = { text: desired.text };
    actualFields = { text };
  } else if (desired.kind === 'calendar') {
    resourceId = String(actual.eventId ?? actual.event_id ?? '');
    const normalized = normalizeFeishuCalendarEvent(actual, desired.calendarId);
    expected = { calendarId: desired.calendarId, title: desired.summary, startAt: new Date(desired.startAt).toISOString(), endAt: new Date(desired.endAt).toISOString() };
    actualFields = { calendarId: normalized.calendarId, title: normalized.title, startAt: normalized.start.dateTime, endAt: normalized.end.dateTime };
  } else if (desired.kind === 'doc') {
    resourceId = String(actual.documentId ?? actual.document_id ?? '');
    expected = { documentId: desired.documentId, text: desired.text };
    actualFields = { documentId: resourceId, text: extractDocText(actual) };
  } else if (desired.kind === 'sheet') {
    resourceId = String(actual.spreadsheetToken ?? actual.spreadsheet_token ?? '');
    expected = { spreadsheetToken: desired.spreadsheetToken, values: desired.values };
    actualFields = { spreadsheetToken: resourceId, values: actual.values ?? [] };
  } else {
    resourceId = String(actual.recordId ?? actual.record_id ?? '');
    expected = { appToken: desired.appToken, tableId: desired.tableId, fields: desired.fields };
    actualFields = { appToken: String(actual.appToken ?? actual.app_token ?? ''), tableId: String(actual.tableId ?? actual.table_id ?? ''), fields: actual.fields ?? {} };
  }
  const matched = resourceId.length > 0 && providerDefinitionHash(actualFields) === providerDefinitionHash(expected);
  return { matched, resourceId, capability, expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(actualFields) };
}

function extractDocText(actual: Record<string, unknown>): string {
  const blocks = actual.blocks;
  if (!Array.isArray(blocks)) return '';
  const texts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === 'object') {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts.join('');
}
