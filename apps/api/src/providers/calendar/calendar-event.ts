import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

const timed = z.object({ dateTime: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(100).refine((v) => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}) }).strict();
const email = z.string().email().max(254).transform((v) => v.toLowerCase());
const approved = z.object({ calendarId: email, title: z.string().min(1).max(512), start: timed, end: timed,
  attendees: z.array(email).max(20), sendUpdates: z.enum(['all', 'externalOnly', 'none']),
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/).optional(), etag: z.string().regex(/^"[^"\r\n]{1,198}"$/).optional() }).strict();
export function prepareCalendarEvent(input: Record<string, unknown>, calendarId: string, key?: string, update = false) {
  const parsed = approved.safeParse((input.context as Record<string, unknown> | undefined)?.calendarEvent);
  if (!parsed.success || !key || !/^[a-f0-9]{64}$/.test(key)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const data = parsed.data;
  if (data.calendarId !== calendarId || Date.parse(data.end.dateTime) <= Date.parse(data.start.dateTime)
    || (update && (!data.eventId || !data.etag)) || (!update && (data.eventId || data.etag))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...data, attendees: [...new Set(data.attendees)].sort(), eventId: update ? data.eventId! : 'la' + key, operationKey: key };
}
export function normalizeCalendarEvent(raw: Record<string, unknown>, calendarId: string) {
  if (!raw || typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,1024}$/.test(raw.id) || typeof raw.etag !== 'string'
    || typeof raw.status !== 'string' || typeof raw.updated !== 'string' || !Number.isFinite(Date.parse(raw.updated))) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const endpoint = (value: unknown) => {
    if (!value || typeof value !== 'object') throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    const d = value as Record<string, unknown>;
    if (typeof d.dateTime === 'string' && Number.isFinite(Date.parse(d.dateTime))) return { dateTime: new Date(d.dateTime).toISOString(), ...(typeof d.timeZone === 'string' ? { timeZone: d.timeZone } : {}) };
    if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { date: d.date };
    throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  };
  if (raw.attendees !== undefined && (!Array.isArray(raw.attendees) || raw.attendees.length > 2000
    || !raw.attendees.every((a) => a && typeof a.email === 'string'))) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const properties = raw.extendedProperties as { private?: Record<string, unknown> } | undefined;
  return { eventId: raw.id, calendarId, title: typeof raw.summary === 'string' ? raw.summary : '', start: endpoint(raw.start), end: endpoint(raw.end),
    attendees: [...new Set((raw.attendees as Array<{ email: string }> | undefined ?? []).map((a) => a.email.toLowerCase()))].sort(),
    attendeesOmitted: raw.attendeesOmitted === true, status: raw.status, etag: raw.etag, updatedAt: new Date(raw.updated).toISOString(),
    operationKey: typeof properties?.private?.lazyArmorOperation === 'string' ? properties.private.lazyArmorOperation : '' };
}
export function calendarReadbackEvidence(actual: ReturnType<typeof normalizeCalendarEvent>, desired: ReturnType<typeof prepareCalendarEvent>) {
  const fields = (data: typeof actual) => ({ calendarId: data.calendarId, title: data.title, start: data.start, end: data.end, attendees: data.attendees });
  const expected = { calendarId: desired.calendarId, title: desired.title,
    start: { ...desired.start, dateTime: new Date(desired.start.dateTime).toISOString() }, end: { ...desired.end, dateTime: new Date(desired.end.dateTime).toISOString() }, attendees: desired.attendees };
  const matched = actual.eventId === desired.eventId && actual.operationKey === desired.operationKey && actual.status === 'confirmed' && !actual.attendeesOmitted
    && providerDefinitionHash(fields(actual)) === providerDefinitionHash(expected);
  return { matched, eventId: actual.eventId, calendarId: actual.calendarId, expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(fields(actual)) };
}
