import { candidateCapability, providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';
export const browserManifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey: 'controlled_browser', providerName: '受控网页', revision: 3,
  providerReview: 'NOT_REQUIRED', accountTypes: ['public'], sourceModes: ['OS_API'], actionModes: ['OBSERVE', 'EXECUTE'], evidence: [], explicitDenials: [],
  rateLimitPolicy: 'Bounded local browser runtime; external website quotas are not asserted',
  capabilities: ['BROWSER_OBSERVE', 'BROWSER_SUBMIT_FORM'].map(key => { const write = key === 'BROWSER_SUBMIT_FORM'; return {
    ...candidateCapability({ key, name: write ? '提交确认的网页表单' : '读取确认的网页字段', resource: 'WebPage', operation: write ? 'execute' : 'read', riskLevel: write ? 'R3' : 'R1', sourceModes: ['OS_API'] }),
    providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'NOT_REQUIRED' as const,
    accountTypes: ['public'], actionModes: [write ? 'EXECUTE' as const : 'OBSERVE' as const], realtimeModes: ['NONE' as const], evidence: [],
    verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['USER_CONFIRMATION'],
    dataBoundary: { resources: ['WebPage'], readableFields: ['scopedText', 'operationMarker'], writableFields: write ? ['confirmedFormFields'] : [], purpose: ['user_authorized_public_website'], retentionDays: 7 },
    sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write, retrySafety: 'unsafe' as const },
  }; }) };
export const browserEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'controlled_browser', key: 'bounded-local-browser', revision: 1,
  kind: 'MANUAL_REVIEW', status: 'NOT_REQUIRED', uri: 'https://playwright.dev/docs/api/class-browsercontext', reviewedAt: null,
  summary: 'Local Chromium driver boundary; this metadata does not verify any external website or real account.',
  contentHash: providerDefinitionHash({ boundary: 'private-context/origin-scope/exact-form/approval/read-back', version: 1 }) };
export const browserPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'controlled_browser', revision: 3, manifestRevision: 3,
  evidence: { key: browserEvidence.key, revision: 1, hash: providerDefinitionHash(browserEvidence) },
  rateLimit: { providerRequests: 10, connectionRequests: 5, windowSeconds: 60 }, quota: { providerUnits: 100, connectionUnits: 30, windowSeconds: 3600,
    capabilityUnits: { BROWSER_OBSERVE: 1, BROWSER_SUBMIT_FORM: 3 } },
  retry: { maxReadAttempts: 1, baseDelayMs: 100, maxDelayMs: 100, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 20000 }, verificationPolicies: [{ key: 'controlled_browser.form.readback', revision: '1', providerKey: 'controlled_browser',
    capabilityKey: 'BROWSER_SUBMIT_FORM', methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 20000, maxAttempts: 3, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] }], errorMapping: [] };
