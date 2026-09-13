import { candidateCapability, providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';
export const GITHUB_CAPABILITIES = ['READ_ISSUE', 'READ_PULL_REQUEST', 'READ_WORKFLOW_STATUS', 'CREATE_ISSUE', 'CREATE_COMMENT'] as const;
const reviewedAt = '2026-09-13T10:00:00.000Z';
const uri = 'https://docs.github.com/en/rest';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: 'OAuth App repo scope, REST 2026-03-10, Issues/PR/Actions, primary/secondary limits and raw-byte webhook signatures reviewed; real-account acceptance remains separate.' };
export const githubManifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey: 'github', providerName: 'GitHub', revision: 2,
  providerReview: 'VERIFIED', accountTypes: ['consumer', 'organization'], sourceModes: ['OFFICIAL_API'], actionModes: ['OBSERVE', 'EXECUTE'],
  rateLimitPolicy: 'Application budgets, not official quota. OAuth App repo scope is broad; actual repository IDs and approved targets restrict access.',
  evidence: [evidence], explicitDenials: [], capabilities: GITHUB_CAPABILITIES.map((key) => {
    const write = key.startsWith('CREATE_'); const resource = key === 'READ_PULL_REQUEST' ? 'PullRequest' : key === 'READ_WORKFLOW_STATUS' ? 'Workflow' : 'Issue';
    return { ...candidateCapability({ key, name: key, resource, operation: write ? 'execute' : 'read', riskLevel: write ? 'R3' : 'R1', sourceModes: ['OFFICIAL_API'] }),
      providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
      oauthScopes: ['repo'], accountTypes: ['consumer', 'organization'], realtimeModes: ['POLL' as const], actionModes: [write ? 'EXECUTE' as const : 'OBSERVE' as const],
      verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
      dataBoundary: { resources: ['Repository', resource], readableFields: ['id', 'number', 'title', 'body', 'state', 'merged', 'status', 'conclusion', 'head_sha', 'updated_at'],
        writableFields: write ? ['title', 'body'] : [], purpose: ['user_authorized_repository_automation'], sensitiveFields: ['title', 'body'], retentionDays: 30 },
      explicitDenials: [], sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write, retrySafety: 'unsafe' as const,
        idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const } };
  }) };
export const githubEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'github', key: 'github-rest-oauth-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, mode: 'OAUTH_APP', scopes: ['repo'], version: '2026-03-10', writeRetry: 'NEVER', reconciliation: 'READ_ONLY_BOUNDED_MARKER_LOOKUP' }) };
export const githubPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'github', revision: 1, manifestRevision: 2,
  evidence: { key: githubEvidence.key, revision: 1, hash: providerDefinitionHash(githubEvidence) },
  rateLimit: { providerRequests: 120, connectionRequests: 60, windowSeconds: 60 },
  quota: { providerUnits: 500, connectionUnits: 200, windowSeconds: 60,
    capabilityUnits: { READ_ISSUE: 3, READ_PULL_REQUEST: 3, READ_WORKFLOW_STATUS: 3, CREATE_ISSUE: 4, CREATE_COMMENT: 5 } },
  retry: { maxReadAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: ['CREATE_ISSUE', 'CREATE_COMMENT'].map((capabilityKey) => ({ key: `github.${capabilityKey.toLowerCase()}.readback`, revision: '1',
    providerKey: 'github', capabilityKey, methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [{ providerCode: 'bad_refresh_token', code: 'AUTH_REVOKED' }, { providerCode: 'bad_verification_code', code: 'AUTH_EXPIRED' },
    { providerCode: 'primary_rate_limit', httpStatus: 403, code: 'RATE_LIMITED' }, { providerCode: 'secondary_rate_limit', httpStatus: 429, code: 'RATE_LIMITED' }] };
