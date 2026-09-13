import { candidateCapability, providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

export const GMAIL_SCOPES = {
  read: 'https://www.googleapis.com/auth/gmail.readonly',
  compose: 'https://www.googleapis.com/auth/gmail.compose',
  send: 'https://www.googleapis.com/auth/gmail.send',
} as const;
export const GMAIL_CAPABILITIES = ['READ_EMAIL_METADATA', 'READ_EMAIL_BODY', 'READ_EMAIL_LABELS', 'CREATE_EMAIL_DRAFT', 'SEND_EMAIL'] as const;
const uri = 'https://developers.google.com/workspace/gmail/api/auth/scopes';
const reviewedAt = '2026-09-13T03:00:00.000Z';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri,
  summary: 'Reviewed Gmail REST scope and read-back contracts; official availability is not real-account acceptance.', verifiedAt: reviewedAt };
export const gmailManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'gmail', providerName: 'Gmail', revision: 2, providerReview: 'VERIFIED',
  accountTypes: ['consumer', 'workspace'], sourceModes: ['OFFICIAL_API'], actionModes: ['OBSERVE', 'PREPARE', 'EXECUTE'],
  rateLimitPolicy: 'Conservative application budget; weighted units include bounded read-back calls.', evidence: [evidence],
  // Runtime explicitDenials means this capability is entirely forbidden. Field
  // restrictions belong in DataBoundary and the adapter, not that kill switch.
  explicitDenials: [],
  capabilities: GMAIL_CAPABILITIES.map((key) => {
    const write = key === 'CREATE_EMAIL_DRAFT' || key === 'SEND_EMAIL';
    return { ...candidateCapability({ key, name: key, resource: 'EmailMessage', operation: write ? 'execute' : 'read',
      riskLevel: key === 'SEND_EMAIL' ? 'R3' : write ? 'R2' : key === 'READ_EMAIL_BODY' ? 'R1' : 'R0', sourceModes: ['OFFICIAL_API'] }),
      providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
      oauthScopes: write ? [key === 'SEND_EMAIL' ? GMAIL_SCOPES.send : GMAIL_SCOPES.compose, GMAIL_SCOPES.read] : [GMAIL_SCOPES.read],
      accountTypes: ['consumer', 'workspace'], realtimeModes: ['POLL' as const], actionModes: [write ? key === 'SEND_EMAIL' ? 'EXECUTE' as const : 'PREPARE' as const : 'OBSERVE' as const],
      verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
      dataBoundary: { resources: ['EmailMessage'], readableFields: key === 'READ_EMAIL_BODY' ? ['id', 'headers', 'labels', 'body'] : ['id', 'headers', 'labels'],
        writableFields: write ? ['to', 'subject', 'body'] : [], purpose: ['user_authorized_email_automation'], sensitiveFields: ['headers', 'body'], retentionDays: 30 },
      explicitDenials: [],
      sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write, retrySafety: 'unsafe' as const,
        idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const },
    };
  }),
};
// This digest identifies the normalized review record, not a downloaded HTML page.
export const gmailEvidence: OfficialEvidenceRevision = {
  schemaVersion: '1', providerKey: 'gmail', key: 'gmail-rest-review', revision: 1, kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri,
  summary: evidence.summary, reviewedAt, contentHash: providerDefinitionHash({ uri, reviewedAt, scopes: GMAIL_SCOPES,
    methods: ['messages.list', 'messages.get', 'messages.send', 'drafts.create', 'drafts.get', 'labels.list', 'getProfile'],
    ambiguousWrite: 'READ_ONLY_RECONCILIATION' }),
};
export const gmailPolicy: ProviderRuntimePolicy = {
  schemaVersion: '1', providerKey: 'gmail', revision: 1, manifestRevision: 2,
  evidence: { key: gmailEvidence.key, revision: 1, hash: providerDefinitionHash(gmailEvidence) },
  rateLimit: { providerRequests: 120, connectionRequests: 60, windowSeconds: 60 },
  quota: { providerUnits: 6000, connectionUnits: 6000, windowSeconds: 60,
    capabilityUnits: { READ_EMAIL_METADATA: 1005, READ_EMAIL_BODY: 1005, READ_EMAIL_LABELS: 20, CREATE_EMAIL_DRAFT: 30, SEND_EMAIL: 120 } },
  retry: { maxReadAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: ['CREATE_EMAIL_DRAFT', 'SEND_EMAIL'].map((capabilityKey) => ({
    key: `gmail.${capabilityKey.toLowerCase()}.readback`, revision: '1', providerKey: 'gmail', capabilityKey,
    methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }],
  })),
  errorMapping: [
    { providerCode: 'invalid_grant', code: 'AUTH_REVOKED' }, { providerCode: 'authError', code: 'AUTH_EXPIRED' },
    { providerCode: 'insufficientPermissions', code: 'SCOPE_MISSING' }, { providerCode: 'userRateLimitExceeded', code: 'RATE_LIMITED' },
    { providerCode: 'rateLimitExceeded', code: 'RATE_LIMITED' }, { providerCode: 'dailyLimitExceeded', code: 'QUOTA_EXCEEDED' },
    { providerCode: 'backendError', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: 'notFound', code: 'RESOURCE_NOT_FOUND' },
  ],
};
