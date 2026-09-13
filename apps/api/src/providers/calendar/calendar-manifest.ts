import { candidateCapability, providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

export const CALENDAR_SCOPES = { read: 'https://www.googleapis.com/auth/calendar.events.readonly',
  write: 'https://www.googleapis.com/auth/calendar.events', metadata: 'https://www.googleapis.com/auth/calendar.calendars.readonly' } as const;
export const CALENDAR_CAPABILITIES = ['READ_CALENDAR_EVENT', 'CREATE_CALENDAR_EVENT', 'UPDATE_CALENDAR_EVENT'] as const;
const uri = 'https://developers.google.com/workspace/calendar/api/auth';
const reviewedAt = '2026-09-13T06:00:00.000Z';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: 'Calendar REST scopes, explicit primary-calendar identity, conditional writes and eventId read-back reviewed; real-account acceptance remains separate.' };
export const calendarManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'google_calendar', providerName: 'Google Calendar', revision: 2, providerReview: 'VERIFIED',
  accountTypes: ['consumer', 'workspace'], sourceModes: ['OFFICIAL_API'], actionModes: ['OBSERVE', 'EXECUTE'],
  rateLimitPolicy: 'Application request budget includes primary identity check and event read-back; not an assertion of the project Google quota.', evidence: [evidence], explicitDenials: [],
  capabilities: CALENDAR_CAPABILITIES.map((key) => {
    const write = key !== 'READ_CALENDAR_EVENT';
    return { ...candidateCapability({ key, name: key, resource: 'CalendarEvent', operation: write ? 'execute' : 'read', riskLevel: write ? 'R3' : 'R1', sourceModes: ['OFFICIAL_API'] }),
      providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
      oauthScopes: [CALENDAR_SCOPES.metadata, write ? CALENDAR_SCOPES.write : CALENDAR_SCOPES.read], accountTypes: ['consumer', 'workspace'], realtimeModes: ['POLL' as const],
      actionModes: [write ? 'EXECUTE' as const : 'OBSERVE' as const], verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
      dataBoundary: { resources: ['CalendarEvent'], readableFields: ['id', 'summary', 'start', 'end', 'attendees', 'status', 'etag', 'updated'],
        writableFields: write ? ['summary', 'start', 'end', 'attendees', 'sendUpdates'] : [], purpose: ['user_authorized_calendar_automation'], sensitiveFields: ['summary', 'attendees'], retentionDays: 30 },
      explicitDenials: [], sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write, retrySafety: 'unsafe' as const,
        idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const } };
  }),
};
export const calendarEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'google_calendar', key: 'calendar-rest-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, scopes: CALENDAR_SCOPES, methods: ['calendars.get', 'events.list', 'events.get', 'events.insert', 'events.patch'],
    conditionalUpdate: 'ETAG_IF_MATCH', ambiguousWrite: 'READ_ONLY_RECONCILIATION' }) };
export const calendarPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'google_calendar', revision: 1, manifestRevision: 2,
  evidence: { key: calendarEvidence.key, revision: 1, hash: providerDefinitionHash(calendarEvidence) },
  rateLimit: { providerRequests: 120, connectionRequests: 60, windowSeconds: 60 },
  quota: { providerUnits: 300, connectionUnits: 120, windowSeconds: 60,
    capabilityUnits: { READ_CALENDAR_EVENT: 2, CREATE_CALENDAR_EVENT: 3, UPDATE_CALENDAR_EVENT: 4 } },
  retry: { maxReadAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: CALENDAR_CAPABILITIES.slice(1).map((capabilityKey) => ({ key: `google_calendar.${capabilityKey.toLowerCase()}.readback`, revision: '1',
    providerKey: 'google_calendar', capabilityKey, methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [{ providerCode: 'invalid_grant', code: 'AUTH_REVOKED' }, { providerCode: 'insufficientPermissions', code: 'SCOPE_MISSING' },
    { providerCode: 'userRateLimitExceeded', code: 'RATE_LIMITED' }, { providerCode: 'rateLimitExceeded', code: 'RATE_LIMITED' },
    { providerCode: 'notFound', code: 'RESOURCE_NOT_FOUND' }, { providerCode: 'conditionNotMet', code: 'PERMISSION_DENIED' }, { providerCode: 'duplicate', code: 'PERMISSION_DENIED' }] };
