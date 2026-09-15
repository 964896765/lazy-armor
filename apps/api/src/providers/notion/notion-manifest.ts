import { candidateCapability, providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

export const NOTION_CAPABILITIES = ['READ_PAGE', 'READ_DATA_SOURCE', 'CREATE_PAGE', 'UPDATE_PAGE'] as const;
export const NOTION_SCOPES = { read: 'read_content', insert: 'insert_content', update: 'update_content' } as const;
const reviewedAt = '2026-09-14T15:00:00.000Z'; const uri = 'https://developers.notion.com/reference/intro';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: 'Public OAuth, content capabilities, Page/Data Source reads, structured property writes, revoke, limits, and read-back reviewed; real workspace acceptance remains separate.' };
export const notionManifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey: 'notion', providerName: 'Notion', revision: 3,
  providerReview: 'VERIFIED', accountTypes: ['workspace'], sourceModes: ['OFFICIAL_API'], actionModes: ['OBSERVE', 'EXECUTE'],
  rateLimitPolicy: 'Application request budget; not an assertion of official workspace quota.', evidence: [evidence], explicitDenials: [],
  capabilities: NOTION_CAPABILITIES.map((key) => { const write = key.startsWith('CREATE_') || key.startsWith('UPDATE_'); const page = key !== 'READ_DATA_SOURCE';
    const scopes = write ? [NOTION_SCOPES.read, key === 'CREATE_PAGE' ? NOTION_SCOPES.insert : NOTION_SCOPES.update] : [NOTION_SCOPES.read];
    return { ...candidateCapability({ key, name: key, resource: page ? 'Page' : 'DataSource', operation: write ? 'execute' : 'read', riskLevel: write ? 'R3' : 'R1', sourceModes: ['OFFICIAL_API'] }),
      providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
      oauthScopes: scopes, accountTypes: ['workspace'], realtimeModes: ['POLL' as const], actionModes: [write ? 'EXECUTE' as const : 'OBSERVE' as const],
      verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP', 'USER_CONFIRMATION'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
      dataBoundary: { resources: key === 'READ_DATA_SOURCE' ? ['DataSource', 'Page'] : [page ? 'Page' : 'DataSource'], readableFields: ['id', 'object', 'parent', 'properties', 'last_edited_time'],
        writableFields: write ? ['properties'] : [], purpose: ['user_authorized_workspace_automation'], sensitiveFields: ['properties'], retentionDays: 30 },
      explicitDenials: [], sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write,
        retrySafety: 'unsafe' as const, idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const } }; }) };
export const notionEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'notion', key: 'notion-public-oauth-properties-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, version: '2026-03-11', scopes: NOTION_SCOPES,
    methods: ['users.me', 'pages.retrieve', 'dataSources.retrieve', 'dataSources.query', 'pages.create', 'pages.update'], writeRetry: 'NEVER', reconciliation: 'READ_ONLY_OR_USER_CONFIRMATION' }) };
export const notionPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'notion', revision: 2, manifestRevision: 3,
  evidence: { key: notionEvidence.key, revision: 1, hash: providerDefinitionHash(notionEvidence) },
  rateLimit: { providerRequests: 60, connectionRequests: 30, windowSeconds: 60 }, quota: { providerUnits: 300, connectionUnits: 150, windowSeconds: 60,
    capabilityUnits: { READ_PAGE: 3, READ_DATA_SOURCE: 3, CREATE_PAGE: 5, UPDATE_PAGE: 5 } },
  retry: { maxReadAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: ['CREATE_PAGE', 'UPDATE_PAGE'].map((capabilityKey) => ({ key: `notion.${capabilityKey.toLowerCase()}.readback`, revision: '1', providerKey: 'notion', capabilityKey,
    methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP', 'USER_CONFIRMATION'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [{ providerCode: 'unauthorized', httpStatus: 401, code: 'AUTH_EXPIRED' }, { providerCode: 'restricted_resource', httpStatus: 403, code: 'SCOPE_MISSING' },
    { providerCode: 'object_not_found', httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }, { providerCode: 'rate_limited', httpStatus: 429, code: 'RATE_LIMITED' },
    { providerCode: 'conflict_error', httpStatus: 409, code: 'PERMISSION_DENIED' }] };
