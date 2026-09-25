import { createHash } from 'node:crypto';
import { canonicalStringify, type JsonValue } from './index';

export const SOURCE_MODES = ['OFFICIAL_API', 'WEBHOOK', 'NOTIFICATION', 'SHARE', 'APP_READ_SESSION', 'FILE', 'MANUAL', 'INTERNAL'] as const;
export const PARSER_KEYS = ['generic.transaction.v1', 'generic.shipment-status.v1', 'generic.connection-health.v1', 'generic.device-status.v1', 'generic.bill-reminder.v1', 'mobile-notification-billing.v1', 'generic.email-message.v1', 'generic.calendar-event.v1', 'generic.repository-resource.v1', 'generic.repository-resource.v2', 'generic.document-resource.v1', 'generic.consumable-remaining.v1', 'generic.household-supply.v1', 'generic.feishu-resource.v1', 'generic.dingtalk-resource.v1', 'generic.wecom-resource.v1', 'generic.structured-read.v1'] as const;
export type SourceMode = typeof SOURCE_MODES[number];
export type ParserKey = typeof PARSER_KEYS[number];

export const REALITY_ADAPTER_REGISTRY = Object.freeze([
  ...PARSER_KEYS.map((key) => Object.freeze({ key, kind: 'PARSER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
  ...['money.v1', 'transaction-reconciliation.v1', 'shipment-status.v1', 'connection-health.v1', 'device-status.v1', 'bill-reminder.v1', 'email-message.v1', 'calendar-event.v1', 'repository-resource.v1', 'repository-resource.v2', 'document-resource.v1', 'consumable-remaining.v1', 'household-supply.v1', 'feishu-resource.v1', 'dingtalk-resource.v1', 'wecom-resource.v1', 'structured-read.v1'].map((key) => Object.freeze({ key, kind: 'NORMALIZER' as const, revision: 1 as const, status: 'ACTIVE' as const })),
]);

export interface SourceObservationInput {
  sourceMode: SourceMode; providerKey: string; connectionId?: string | null;
  externalEventKey: string; parserKey: ParserKey; resourceHint: string;
  payload: Record<string, JsonValue>; evidenceHash: string;
  observedAt: string; occurredAt?: string | null;
  deviceId?: string | null;
}

export interface NormalizedFactDraft {
  resourceType: 'finance.transaction' | 'shipment' | 'digital_account.connection' | 'DeviceStatus' | 'Bill' | 'EmailMessage' | 'CalendarEvent' | 'Repository' | 'Issue' | 'PullRequest' | 'Workflow' | 'Page' | 'DataSource' | 'FeishuResource' | 'DingTalkResource' | 'WeComResource' | 'StructuredRead' | 'device.consumable' | 'household.supply';
  resourceKey: string; subjectKey: string; factKey: 'finance.transaction.amount' | 'shipment.status' | 'digital_account.connection.health' | 'device_status.status.state' | 'bill.bill.state' | 'email_message.metadata' | 'email_message.body' | 'email_message.labels' | 'calendar_event.schedule' | 'repository.metadata' | 'issue.state' | 'pull_request.state' | 'workflow.run_status' | 'page.properties' | 'data_source.schema' | 'feishu.resource.state' | 'dingtalk.resource.state' | 'wecom.resource.state' | 'structured_read.field' | 'device.consumable.remaining_days' | 'household.supply.remaining_days';
  value: Record<string, JsonValue>; confidence: number; normalizerKey: string;
  freshnessPolicyKey: 'transaction.default' | 'shipment.status' | 'connection.health' | 'device.status' | 'bill.reminder' | 'email.message' | 'calendar.event' | 'repository.resource' | 'repository.resource.v2' | 'document.resource.v1' | 'feishu.resource' | 'dingtalk.resource' | 'wecom.resource' | 'structured.read' | 'consumable.remaining' | 'household.supply';
  conflictPolicyKey: 'latest_verified_then_observed' | 'latest_verified_then_observed.v2';
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
  policy('device.status', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('bill.reminder', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('consumable.remaining', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('household.supply', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('email.message', 'FRESHNESS', { ttlSeconds: 86400, onStale: 'refresh' }),
  policy('calendar.event', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('repository.resource', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('latest_verified_then_observed', 'CONFLICT', { order: ['verificationLevel', 'occurredAt', 'observedAt'], unresolved: 'block' }),
  policy('repository.resource.v2', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh', revalidation: 'authenticated_read_audit_without_mutating_truth_version' }),
  policy('document.resource.v1', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh', revalidation: 'authenticated_read_audit_without_mutating_truth_version' }),
  policy('feishu.resource', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('dingtalk.resource', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('wecom.resource', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('structured.read', 'FRESHNESS', { ttlSeconds: 300, onStale: 'refresh' }),
  policy('latest_verified_then_observed.v2', 'CONFLICT', { order: ['verificationLevel', 'providerUpdatedAt', 'observedAt'], stale: 'supersede_candidate', equalTimeDifferentValue: 'block', unchanged: 'revalidate', history: 'append_only' }),
]);

const requireString = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (typeof value !== 'string' || !value) throw new Error(`Parser requires ${key}`); return value;
};
const requireInteger = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Parser requires non-negative integer ${key}`); return value as number;
};
const requireNumber = (payload: Record<string, JsonValue>, key: string) => {
  const value = payload[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Parser requires non-negative number ${key}`); return value;
};
const optionalText = (value: JsonValue | undefined, max: number) => {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Parser received invalid optional text');
  return value.trim();
};
const optionalIdentity = (value: JsonValue | undefined) => {
  const result = optionalText(value, 180);
  if (result && !/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error('Parser received invalid transaction identity');
  return result;
};
const optionalEnum = <T extends readonly string[]>(value: JsonValue | undefined, values: T): T[number] | null => {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !values.includes(value)) throw new Error('Parser received invalid transaction state');
  return value as T[number];
};

export function parseAndNormalizeObservation(input: SourceObservationInput): NormalizedFactDraft[] {
  if (input.parserKey === 'generic.document-resource.v1') {
    if (!input.connectionId) throw new Error('Document resource observation requires connectionId');
    const type = requireString(input.payload, 'resourceType'); const id = requireString(input.payload, 'resourceId'); const workspaceId = requireString(input.payload, 'workspaceId');
    if (!['Page', 'DataSource'].includes(type) || !/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(workspaceId)
      || input.resourceHint !== type || typeof input.payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.payload.updatedAt))
      || !input.payload.properties || typeof input.payload.properties !== 'object' || Array.isArray(input.payload.properties)) throw new Error('Invalid versioned document resource');
    const subjectKey = `${input.connectionId}:${workspaceId}:${type}:${id}`;
    return [{ resourceType: type as 'Page' | 'DataSource', resourceKey: subjectKey, subjectKey,
      factKey: type === 'Page' ? 'page.properties' : 'data_source.schema', value: input.payload, confidence: 1,
      normalizerKey: 'document-resource.v1', freshnessPolicyKey: 'document.resource.v1', conflictPolicyKey: 'latest_verified_then_observed.v2' }];
  }
  if (input.parserKey === 'generic.feishu-resource.v1') {
    if (!input.connectionId) throw new Error('Feishu resource observation requires connectionId');
    const type = requireString(input.payload, 'resourceType'); const id = requireString(input.payload, 'resourceId');
    const tenantKey = requireString(input.payload, 'tenantKey');
    if (!['FeishuMessage', 'FeishuDoc', 'FeishuSheet', 'FeishuBitable', 'FeishuApproval'].includes(type)
      || input.resourceHint !== type || typeof input.payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.payload.updatedAt)))
      throw new Error('Invalid Feishu resource identity');
    const subjectKey = `${input.connectionId}:${tenantKey}:${type}:${id}`;
    return [{ resourceType: 'FeishuResource', resourceKey: subjectKey, subjectKey, factKey: 'feishu.resource.state',
      value: input.payload, confidence: 1, normalizerKey: 'feishu-resource.v1', freshnessPolicyKey: 'feishu.resource',
      conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.dingtalk-resource.v1') {
    if (!input.connectionId) throw new Error('DingTalk resource observation requires connectionId');
    const type = requireString(input.payload, 'resourceType'); const id = requireString(input.payload, 'resourceId');
    const corpId = requireString(input.payload, 'corpId');
    if (!['DingTalkMessage', 'DingTalkApproval', 'DingTalkWorkNotification', 'DingTalkDing'].includes(type)
      || input.resourceHint !== type || typeof input.payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.payload.updatedAt)))
      throw new Error('Invalid DingTalk resource identity');
    const subjectKey = `${input.connectionId}:${corpId}:${type}:${id}`;
    return [{ resourceType: 'DingTalkResource', resourceKey: subjectKey, subjectKey, factKey: 'dingtalk.resource.state',
      value: input.payload, confidence: 1, normalizerKey: 'dingtalk-resource.v1', freshnessPolicyKey: 'dingtalk.resource',
      conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.wecom-resource.v1') {
    if (!input.connectionId) throw new Error('WeCom resource observation requires connectionId');
    const type = requireString(input.payload, 'resourceType'); const id = requireString(input.payload, 'resourceId');
    const corpId = requireString(input.payload, 'corpId');
    if (!['WeComMessage', 'WeComApproval'].includes(type)
      || input.resourceHint !== type || typeof input.payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.payload.updatedAt)))
      throw new Error('Invalid WeCom resource identity');
    const subjectKey = `${input.connectionId}:${corpId}:${type}:${id}`;
    return [{ resourceType: 'WeComResource', resourceKey: subjectKey, subjectKey, factKey: 'wecom.resource.state',
      value: input.payload, confidence: 1, normalizerKey: 'wecom-resource.v1', freshnessPolicyKey: 'wecom.resource',
      conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.structured-read.v1') {
    const resourceType = requireString(input.payload, 'resourceType');
    const resourceId = requireString(input.payload, 'resourceId');
    const sourceIdentity = requireString(input.payload, 'sourceIdentity');
    const readMethod = requireString(input.payload, 'readMethod');
    const observedAt = requireString(input.payload, 'observedAt');
    const fields = input.payload.fields;
    if (!Array.isArray(fields) || fields.length === 0) throw new Error('Structured read requires extracted fields');
    const resourceKey = `${sourceIdentity}:${resourceType}:${resourceId}`;
    const resourceVersion = typeof input.payload.resourceVersion === 'string' && input.payload.resourceVersion ? input.payload.resourceVersion : null;
    return fields.map((item) => {
      const raw = (item && typeof item === 'object' && !Array.isArray(item) ? item : {}) as Record<string, JsonValue>;
      const field = requireString(raw, 'field');
      const validation = (raw.validation && typeof raw.validation === 'object' && !Array.isArray(raw.validation) ? raw.validation : {}) as Record<string, JsonValue>;
      if (validation.status === 'EXTRACTION_INVALID') throw new Error(`Structured read field ${field} did not pass deterministic validation`);
      if (!('normalizedValue' in raw)) throw new Error(`Structured read field ${field} requires normalizedValue`);
      const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? (raw.confidence as number) : 0;
      const value: Record<string, JsonValue> = {
        field, value: raw.normalizedValue, type: typeof raw.type === 'string' ? raw.type : 'string',
        confidence, readMethod, resourceType, resourceId, observedAt,
        ...(resourceVersion ? { resourceVersion } : {}),
      };
      return {
        resourceType: 'StructuredRead' as const, resourceKey, subjectKey: `${resourceKey}:${field}`,
        factKey: 'structured_read.field' as const, value, confidence, normalizerKey: 'structured-read.v1',
        freshnessPolicyKey: 'structured.read' as const, conflictPolicyKey: 'latest_verified_then_observed.v2' as const,
      };
    });
  }
  if (input.parserKey === 'generic.repository-resource.v1' || input.parserKey === 'generic.repository-resource.v2') {
    const versioned = input.parserKey === 'generic.repository-resource.v2';
    if (!input.connectionId) throw new Error('Repository resource observation requires connectionId');
    const type = requireString(input.payload, 'resourceType'); const id = requireString(input.payload, 'resourceId');
    const repositoryId = requireInteger(input.payload, 'repositoryId');
    const keys = { Repository: 'repository.metadata', Issue: 'issue.state', PullRequest: 'pull_request.state', Workflow: 'workflow.run_status' } as const;
    if (!Object.hasOwn(keys, type) || repositoryId <= 0 || !/^[1-9][0-9]*$/.test(id)) throw new Error('Invalid repository resource identity');
    if ((type === 'Issue' || type === 'PullRequest') && !['open', 'closed'].includes(String(input.payload.state))) throw new Error('Invalid issue/PR state');
    if (type === 'PullRequest' && typeof input.payload.merged !== 'boolean') throw new Error('PR requires actual merged evidence');
    if (type === 'Workflow' && typeof input.payload.status !== 'string') throw new Error('Workflow requires actual run status');
    if (type === 'Repository' && (String(repositoryId) !== id || typeof input.payload.owner !== 'string' || typeof input.payload.name !== 'string'
      || typeof input.payload.private !== 'boolean')) throw new Error('Invalid repository metadata');
    if (versioned && (input.resourceHint !== type || typeof input.payload.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(input.payload.updatedAt)))) throw new Error('Versioned resource requires matching resource hint and provider update time');
    const subjectKey = `${input.connectionId}:${repositoryId}:${type}:${id}`;
    return [{ resourceType: type as keyof typeof keys, resourceKey: subjectKey, subjectKey, factKey: keys[type as keyof typeof keys], value: input.payload,
      confidence: 1, normalizerKey: versioned ? 'repository-resource.v2' : 'repository-resource.v1',
      freshnessPolicyKey: versioned ? 'repository.resource.v2' : 'repository.resource', conflictPolicyKey: versioned ? 'latest_verified_then_observed.v2' : 'latest_verified_then_observed' }];
  }
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
    if (Math.abs(amountMinor) > 2_147_483_647) throw new Error('Parser requires an in-range minor amount');
    const transactionId = optionalIdentity(input.payload.transactionId);
    const relatedTransactionId = optionalIdentity(input.payload.relatedTransactionId);
    const merchant = optionalText(input.payload.merchant, 160);
    const direction = optionalEnum(input.payload.direction, ['DEBIT', 'CREDIT'] as const);
    const transactionState = optionalEnum(input.payload.transactionState, ['POSTED', 'PENDING', 'REFUND', 'REVERSAL'] as const);
    // Cross-source matching only follows a stable source-supplied transaction id.
    // Time/amount/merchant similarity must never silently merge transactions.
    // The source provider (and account connection when present) namespaces the id
    // so two sources cannot collide on the same external transaction id.
    const sourceNamespace = input.connectionId ? `${input.providerKey}:${input.connectionId}` : input.providerKey;
    const canonicalSubject = transactionId ? `finance.transaction:${sourceNamespace}:${transactionId}` : subjectKey;
    const value: Record<string, JsonValue> = { amountMinor, currency };
    if (transactionId) value.transactionId = transactionId;
    if (relatedTransactionId) value.relatedTransactionId = relatedTransactionId;
    if (merchant) value.merchant = merchant;
    if (direction) value.direction = direction;
    if (transactionState) value.transactionState = transactionState;
    return [{ resourceType: 'finance.transaction', resourceKey: canonicalSubject, subjectKey: canonicalSubject, factKey: 'finance.transaction.amount', value, confidence: input.parserKey === 'mobile-notification-billing.v1' ? 0.8 : 1, normalizerKey: 'transaction-reconciliation.v1', freshnessPolicyKey: 'transaction.default', conflictPolicyKey: 'latest_verified_then_observed', ...(input.parserKey === 'mobile-notification-billing.v1' ? { compatibilityResourceKey: 'mobile.billing.transaction' } : {}) }];
  }
  if (input.parserKey === 'generic.shipment-status.v1') {
    const status = requireString(input.payload, 'status');
    return [{ resourceType: 'shipment', resourceKey: subjectKey, subjectKey, factKey: 'shipment.status', value: { status }, confidence: 1, normalizerKey: 'shipment-status.v1', freshnessPolicyKey: 'shipment.status', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.device-status.v1') {
    const status = requireString(input.payload, 'status');
    return [{ resourceType: 'DeviceStatus', resourceKey: subjectKey, subjectKey, factKey: 'device_status.status.state', value: { status }, confidence: 1, normalizerKey: 'device-status.v1', freshnessPolicyKey: 'device.status', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.bill-reminder.v1') {
    const status = requireString(input.payload, 'status');
    return [{ resourceType: 'Bill', resourceKey: subjectKey, subjectKey, factKey: 'bill.bill.state', value: { status }, confidence: 1, normalizerKey: 'bill-reminder.v1', freshnessPolicyKey: 'bill.reminder', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.consumable-remaining.v1') {
    const value: Record<string, JsonValue> = { remainingDays: requireNumber(input.payload, 'remainingDays') };
    if (typeof input.payload.levelPercent === 'number') value.levelPercent = input.payload.levelPercent;
    if (typeof input.payload.estimatedReplacementAt === 'string') value.estimatedReplacementAt = input.payload.estimatedReplacementAt;
    if (typeof input.payload.consumableType === 'string') value.consumableType = input.payload.consumableType;
    return [{ resourceType: 'device.consumable', resourceKey: subjectKey, subjectKey, factKey: 'device.consumable.remaining_days', value, confidence: 1, normalizerKey: 'consumable-remaining.v1', freshnessPolicyKey: 'consumable.remaining', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  if (input.parserKey === 'generic.household-supply.v1') {
    const value: Record<string, JsonValue> = { remainingDays: requireNumber(input.payload, 'remainingDays') };
    if (typeof input.payload.itemName === 'string') value.itemName = input.payload.itemName;
    if (typeof input.payload.category === 'string') value.category = input.payload.category;
    if (typeof input.payload.estimatedRunOutAt === 'string') value.estimatedRunOutAt = input.payload.estimatedRunOutAt;
    return [{ resourceType: 'household.supply', resourceKey: subjectKey, subjectKey, factKey: 'household.supply.remaining_days', value, confidence: 1, normalizerKey: 'household-supply.v1', freshnessPolicyKey: 'household.supply', conflictPolicyKey: 'latest_verified_then_observed' }];
  }
  const status = requireString(input.payload, 'status');
  return [{ resourceType: 'digital_account.connection', resourceKey: subjectKey, subjectKey, factKey: 'digital_account.connection.health', value: { status }, confidence: 1, normalizerKey: 'connection-health.v1', freshnessPolicyKey: 'connection.health', conflictPolicyKey: 'latest_verified_then_observed' }];
}

export function realityValueHash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
export function observationIdentity(providerKey: string, externalEventKey: string) { return createHash('sha256').update(`${providerKey}:${externalEventKey}`).digest('hex'); }
export function candidateDedupeKey(userId: string, draft: NormalizedFactDraft) {
  const identity = { userId, resourceType: draft.resourceType, resourceKey: draft.resourceKey, subjectKey: draft.subjectKey, factKey: draft.factKey, valueHash: realityValueHash(draft.value) };
  // Only the new normalizer has a new namespace. Every historical v1 hash stays identical.
  return realityValueHash(draft.normalizerKey === 'repository-resource.v2' ? { ...identity, normalizationRevision: 2 }
    : draft.normalizerKey === 'document-resource.v1' ? { ...identity, normalizationRevision: 'document-1' } : identity);
}
export function versionedFactIdentity(userId: string, connectionId: string, draft: { resourceType: string; resourceKey: string; subjectKey: string; factKey: string }) {
  return realityValueHash({ schema: 'generic-resource-identity-v1', userId, connectionId, resourceType: draft.resourceType,
    resourceKey: draft.resourceKey, subjectKey: draft.subjectKey, factKey: draft.factKey });
}
