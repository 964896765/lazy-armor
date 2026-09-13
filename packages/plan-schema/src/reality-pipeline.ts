import { createHash } from 'node:crypto';
import { canonicalStringify, type JsonValue } from './index';

export const SOURCE_MODES = ['OFFICIAL_API', 'WEBHOOK', 'NOTIFICATION', 'SHARE', 'FILE', 'MANUAL', 'INTERNAL'] as const;
export const PARSER_KEYS = ['generic.transaction.v1', 'generic.shipment-status.v1', 'generic.connection-health.v1', 'mobile-notification-billing.v1', 'generic.email-message.v1', 'generic.calendar-event.v1'] as const;
export type SourceMode = typeof SOURCE_MODES[number];
export type ParserKey = typeof PARSER_KEYS[number];

export const REALITY_ADAPTER_REGISTRY = Object.freeze([
  ...PARSER_KEYS.map((key) => Object.freeze({ key, kind: 'PARSER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
  ...['money.v1', 'shipment-status.v1', 'connection-health.v1', 'email-message.v1', 'calendar-event.v1'].map((key) => Object.freeze({ key, kind: 'NORMALIZER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
]);

export interface SourceObservationInput {
  sourceMode: SourceMode; providerKey: string; connectionId?: string | null;
  externalEventKey: string; parserKey: ParserKey; resourceHint: string;
  payload: Record<string, JsonValue>; evidenceHash: string;
  observedAt: string; occurredAt?: string | null;
}

export interface NormalizedFactDraft {
  resourceType: 'finance.transaction' | 'shipment' | 'digital_account.connection' | 'EmailMessage' | 'CalendarEvent';
  resourceKey: string; subjectKey: string; factKey: 'finance.transaction.amount' | 'shipment.status' | 'digital_account.connection.health' | 'email_message.metadata' | 'email_message.body' | 'email_message.labels' | 'calendar_event.schedule';
  value: Record<string, JsonValue>; confidence: number; normalizerKey: string;
  freshnessPolicyKey: 'transaction.default' | 'shipment.status' | 'connection.health' | 'email.message' | 'calendar.event';
  conflictPolicyKey: 'latest_verified_then_observed';
  compatibilityResourceKey?: string;
}

export interface RealityPolicyDefinition {
  key: string; revision: 1; kind: 'DEDUPE' | 'FRESHNESS' | 'CONFLICT'; definition: Record<string, JsonValue>;
}

const policy = (key: string, kind: RealityPolicyDefinition['kind'], definition: Record<string, JsonValue>): RealityPolicyDefinition => ({ key, revision: 1, kind, definition });
export const REALITY_POLICY_REGISTRY: readonly RealityPolicyDefinition[] = Object.freeze([
  policy('semantic-identity.v1', 'DEDUPE', { fields: ['userId', 'resourceType', 'resourceKey', 'subjectKey', 'factKey', 'valueHash'] }),
  policy('transaction.default', 'FRESHNESS', { ttlSeconds: 31536000, onStale: 'retain_historical' }),
  policy('shipment.status', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('connection.health', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('email.message', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('calendar.event', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('latest_verified_then_observed', 'CONFLICT', { order: ['verificationLevel', 'occurredAt', 'observedAt'], unresolved: 'block' }),
]);

const requireString = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (typeof value !== 'string' || !value) throw new Error(`Parser requires ${key}`); return value;
};
const requireInteger = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Parser requires non-negative integer ${key}`); return value as number;
};

export function parseAndNormalizeObservation(input: SourceObservationInput): NormalizedFactDraft[] {
  if (input.parserKey === 'generic.calendar-event.v1') {
    if (!input.connectionId) throw new Error('Calendar observation requires connectionId');
    const id = requireString(input.payload, 'eventId'); const calendarId = requireString(input.payload, 'calendarId');
    if (typeof input.payload.title !== 'string' || !input.payload.start || typeof input.payload.start !== 'object'
      || !input.payload.end || typeof input.payload.end !== 'object' || !Array.isArray(input.payload.attendees)
      || !input.payload.attendees.every((v) => typeof v === 'string')) throw new Error('Invalid calendar event');
    const subjectKey = `${input.connectionId}:${calendarId}:${id}`;
    return [{ resourceType: 'CalendarEvent', resourceKey: subjectKey, subjectKey, factKey: 'calendar_event.schedule',
      value: { eventId: id, calendarId, title: input.payload.title, start: input.payload.start, end: input.payload.end,
        attendees: input.payload.attendees, status: requireString(input.payload, 'status'), etag: requireString(input.payload, 'etag'), updatedAt: requireString(input.payload, 'updatedAt') },
      confidence: 1, normalizerKey: 'calendar-event.v1', freshnessPolicyKey: 'calendar.event', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.email-message.v1') {
    if (!input.connectionId) throw new Error('Email observation requires connectionId');
    const id = requireString(input.payload, 'messageId');
    const emailSubject = `${input.connectionId}:${id}`;
    if (typeof input.payload.subject !== 'string' || typeof input.payload.from !== 'string'
      || !Array.isArray(input.payload.to) || !input.payload.to.every((v) => typeof v === 'string')
      || !Array.isArray(input.payload.labels) || !input.payload.labels.every((v) => typeof v === 'string')) throw new Error('Invalid email metadata');
    const draft = (factKey: NormalizedFactDraft['factKey'], value: Record<string, JsonValue>): NormalizedFactDraft => ({
      resourceType: 'EmailMessage', resourceKey: emailSubject, subjectKey: emailSubject, factKey, value, confidence: 1,
      normalizerKey: 'email-message.v1', freshnessPolicyKey: 'email.message', conflictPolicyKey: 'latest_verified_then_observed' });
    const facts = [draft('email_message.metadata', { messageId: id, subject: input.payload.subject, from: input.payload.from,
      to: input.payload.to, occurredAt: requireString(input.payload, 'occurredAt') }), draft('email_message.labels', { labels: input.payload.labels })];
    if (typeof input.payload.plainText === 'string') facts.push(draft('email_message.body', { plainText: input.payload.plainText }));
    return facts;
  }
  const subjectKey = typeof input.payload.subjectKey === 'string' && input.payload.subjectKey ? input.payload.subjectKey : input.externalEventKey;
  if (input.parserKey === 'generic.transaction.v1' || input.parserKey === 'mobile-notification-billing.v1') {
    const amountMinor = requireInteger(input.payload, 'amountMinor');
    const currency = requireString(input.payload, 'currency');
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Parser requires ISO currency');
    return [{ resourceType: 'finance.transaction', resourceKey: subjectKey, subjectKey, factKey: 'finance.transaction.amount', value: { amountMinor, currency }, confidence: input.parserKey === 'mobile-notification-billing.v1' ? 0.8 : 1, normalizerKey: 'money.v1', freshnessPolicyKey: 'transaction.default', conflictPolicyKey: 'latest_verified_then_observed', ...(input.parserKey === 'mobile-notification-billing.v1' ? { compatibilityResourceKey: 'mobile.billing.transaction' } : {}) }];
  }
  if (input.parserKey === 'generic.shipment-status.v1') {
    const status = requireString(input.payload, 'status');
    return [{ resourceType: 'shipment', resourceKey: subjectKey, subjectKey, factKey: 'shipment.status', value: { status }, confidence: 1, normalizerKey: 'shipment-status.v1', freshnessPolicyKey: 'shipment.status', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  const status = requireString(input.payload, 'status');
  return [{ resourceType: 'digital_account.connection', resourceKey: subjectKey, subjectKey, factKey: 'digital_account.connection.health', value: { status }, confidence: 1, normalizerKey: 'connection-health.v1', freshnessPolicyKey: 'connection.health', conflictPolicyKey: 'latest_verified_then_observed' }];
}

export function realityValueHash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
export function observationIdentity(providerKey: string, externalEventKey: string) { return createHash('sha256').update(`${providerKey}:${externalEventKey}`).digest('hex'); }
export function candidateDedupeKey(userId: string, draft: NormalizedFactDraft) { return realityValueHash({ userId, resourceType: draft.resourceType, resourceKey: draft.resourceKey, subjectKey: draft.subjectKey, factKey: draft.factKey, valueHash: realityValueHash(draft.value) }); }
