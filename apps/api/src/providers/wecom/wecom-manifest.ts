import { candidateCapability, providerDefinitionHash, type OfficialEvidenceRevision, type ProviderCapabilityManifest, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

// WeCom / 企业微信 China-first provider manifest. Reuses the single first-party
// chain end-to-end; it only declares the WeCom slice of that chain.

export const WECOM_SOURCE_CAPABILITIES = ['WECOM_APPROVAL_STATUS_READ', 'WECOM_CALENDAR_READ', 'WECOM_APP_MESSAGE_EVENT'] as const;
export const WECOM_ACTION_CAPABILITIES = ['WECOM_APP_MESSAGE_SEND', 'WECOM_CALENDAR_CREATE', 'WECOM_CALENDAR_UPDATE', 'WECOM_APPROVAL_PREPARE'] as const;
export const WECOM_CAPABILITIES = [...WECOM_SOURCE_CAPABILITIES, ...WECOM_ACTION_CAPABILITIES] as const;

export const WECOM_SCOPES = {
  snsapiBase: 'snsapi_base',
  snsapiPrivateInfo: 'snsapi_privateinfo',
  approvalRead: 'approval:read',
  approvalWrite: 'approval:write',
  calendarRead: 'calendar:read',
  calendarWrite: 'calendar:write',
  messageEvent: 'message:event:read',
  messageWrite: 'message:send',
} as const;

export const WECOM_EXPLICIT_DENIALS = ['DELETE_CALENDAR', 'BULK_MESSAGE', 'ADMIN_PERMISSION_CHANGE', 'APPROVAL_FORCE_DECISION'] as const;

export const AWAITING_WECOM_CREDENTIALS = 'AWAITING_WECOM_CREDENTIALS';
export const AWAITING_WECOM_OAUTH_EVIDENCE = 'AWAITING_WECOM_OAUTH_EVIDENCE';
export const AWAITING_WECOM_EVENT_EVIDENCE = 'AWAITING_WECOM_EVENT_EVIDENCE';

const uri = 'https://developer.work.weixin.qq.com/document/';
const reviewedAt = '2026-09-19T00:00:00.000Z';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: '企业微信开放平台公开文档中的 capability 声明、成员 OAuth 授权、消息回调与读写边界已核对；真实企业/应用凭证、成员授权验收与事件验收分别保持 ' + AWAITING_WECOM_CREDENTIALS + ' / ' + AWAITING_WECOM_OAUTH_EVIDENCE + ' / ' + AWAITING_WECOM_EVENT_EVIDENCE + '，不得标记为 VERIFIED。' };

interface WeComCapabilitySpec {
  key: typeof WECOM_CAPABILITIES[number];
  name: string;
  resource: string;
  operation: 'read' | 'execute';
  riskLevel: 'R1' | 'R3';
  scopes: string[];
  resourceHint: string;
  readableFields: string[];
  writableFields: string[];
  purpose: string;
  realtimeModes: Array<'POLL' | 'WEBHOOK'>;
  actionMode: 'OBSERVE' | 'PREPARE' | 'EXECUTE';
  sensitiveFields: string[];
}

const SOURCE_SPECS: WeComCapabilitySpec[] = [
  { key: 'WECOM_APPROVAL_STATUS_READ', name: '读取企业微信审批状态', resource: 'WeComApproval', operation: 'read', riskLevel: 'R1', scopes: [WECOM_SCOPES.snsapiBase, WECOM_SCOPES.approvalRead],
    resourceHint: 'WeComApproval', readableFields: ['spNo', 'status', 'form', 'updatedAt'], writableFields: [],
    purpose: 'APP_AUTHORIZED_APPROVAL_RESOURCE', realtimeModes: ['POLL'], actionMode: 'OBSERVE', sensitiveFields: ['form'] },
  { key: 'WECOM_CALENDAR_READ', name: '读取企业微信日历', resource: 'CalendarEvent', operation: 'read', riskLevel: 'R1', scopes: [WECOM_SCOPES.snsapiBase, WECOM_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end', 'attendees', 'status'], writableFields: [],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'OBSERVE', sensitiveFields: ['title', 'attendees'] },
  { key: 'WECOM_APP_MESSAGE_EVENT', name: '读取企业微信应用消息事件', resource: 'WeComMessage', operation: 'read', riskLevel: 'R1', scopes: [WECOM_SCOPES.messageEvent],
    resourceHint: 'WeComMessage', readableFields: ['msgId', 'corpId', 'fromUser', 'content', 'createTime'], writableFields: [],
    purpose: 'BOT_VISIBLE_MESSAGE_EVENT', realtimeModes: ['WEBHOOK'], actionMode: 'OBSERVE', sensitiveFields: ['content'] },
];

const ACTION_SPECS: WeComCapabilitySpec[] = [
  { key: 'WECOM_APP_MESSAGE_SEND', name: '以应用身份发送消息', resource: 'WeComMessage', operation: 'execute', riskLevel: 'R3', scopes: [WECOM_SCOPES.messageWrite],
    resourceHint: 'WeComMessage', readableFields: ['msgId', 'corpId', 'content'], writableFields: ['touser', 'text'],
    purpose: 'APP_AUTHORIZED_MESSAGE_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['text'] },
  { key: 'WECOM_CALENDAR_CREATE', name: '创建企业微信日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [WECOM_SCOPES.calendarWrite, WECOM_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['summary'] },
  { key: 'WECOM_CALENDAR_UPDATE', name: '更新企业微信日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [WECOM_SCOPES.calendarWrite, WECOM_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'eventId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['summary'] },
  { key: 'WECOM_APPROVAL_PREPARE', name: '准备企业微信审批实例', resource: 'WeComApproval', operation: 'execute', riskLevel: 'R3', scopes: [WECOM_SCOPES.approvalWrite, WECOM_SCOPES.approvalRead],
    resourceHint: 'WeComApproval', readableFields: ['spNo', 'templateId', 'status'], writableFields: ['creatorUserid', 'templateId', 'formValues'],
    purpose: 'APP_AUTHORIZED_APPROVAL_RESOURCE', realtimeModes: ['POLL'], actionMode: 'PREPARE', sensitiveFields: ['formValues'] },
];

function capability(spec: WeComCapabilitySpec) {
  const write = spec.operation === 'execute';
  return { ...candidateCapability({ key: spec.key, name: spec.name, resource: spec.resource, operation: spec.operation,
    riskLevel: spec.riskLevel, sourceModes: ['OFFICIAL_API', 'WEBHOOK'] }),
    providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
    oauthScopes: spec.scopes, accountTypes: ['tenant', 'user'], realtimeModes: spec.realtimeModes,
    actionModes: [spec.actionMode],
    verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
    dataBoundary: { resources: [spec.resource], readableFields: spec.readableFields, writableFields: spec.writableFields,
      purpose: [spec.purpose], sensitiveFields: spec.sensitiveFields, retentionDays: 30 },
    explicitDenials: [], sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write,
      retrySafety: 'unsafe' as const, idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const } };
}

export const wecomManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'wecom', providerName: '企业微信 / WeCom', revision: 1, providerReview: 'VERIFIED',
  accountTypes: ['tenant', 'user'], sourceModes: ['OFFICIAL_API', 'WEBHOOK'], actionModes: ['OBSERVE', 'PREPARE', 'EXECUTE'],
  rateLimitPolicy: 'Application request budget (tenant/connection weighted); not an assertion of official WeCom quota. Real credentials remain AWAITING_WECOM_CREDENTIALS.',
  evidence: [evidence], explicitDenials: [],
  capabilities: [...SOURCE_SPECS, ...ACTION_SPECS].map(capability),
};

export const wecomEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'wecom', key: 'wecom-open-platform-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, modes: ['APP_TENANT', 'USER_DELEGATED_OAUTH'], scopes: WECOM_SCOPES,
    methods: ['cgi-bin/gettoken', 'cgi-bin/auth/getuserinfo', 'cgi-bin/message/send', 'cgi-bin/oa/schedule', 'cgi-bin/oa/getapprovaldetail', 'cgi-bin/oa/applyevent'],
    writeRetry: 'NEVER', reconciliation: 'READ_ONLY_BOUNDED_MARKER_LOOKUP', credentialAcceptance: AWAITING_WECOM_CREDENTIALS,
    oauthAcceptance: AWAITING_WECOM_OAUTH_EVIDENCE, eventAcceptance: AWAITING_WECOM_EVENT_EVIDENCE }) };

const capabilityUnits = Object.fromEntries(WECOM_CAPABILITIES.map((key) => [key, key.startsWith('WECOM_APP_MESSAGE') || key.includes('CALENDAR') ? 5 : 4])) as Record<typeof WECOM_CAPABILITIES[number], number>;

export const wecomPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'wecom', revision: 1, manifestRevision: 1,
  evidence: { key: wecomEvidence.key, revision: 1, hash: providerDefinitionHash(wecomEvidence) },
  rateLimit: { providerRequests: 100, connectionRequests: 50, windowSeconds: 60 },
  quota: { providerUnits: 500, connectionUnits: 200, windowSeconds: 60, capabilityUnits },
  retry: { maxReadAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: WECOM_ACTION_CAPABILITIES.map((capabilityKey) => ({ key: `wecom.${capabilityKey.toLowerCase()}.readback`, revision: '1',
    providerKey: 'wecom', capabilityKey, methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [
    { providerCode: '40014', code: 'AUTH_EXPIRED' }, { providerCode: '42001', code: 'AUTH_EXPIRED' }, { providerCode: '42007', code: 'AUTH_EXPIRED' },
    { providerCode: '40001', code: 'AUTH_REVOKED' }, { providerCode: '40005', code: 'AUTH_REVOKED' },
    { providerCode: '48002', code: 'PERMISSION_DENIED' }, { providerCode: '60011', code: 'PERMISSION_DENIED' }, { providerCode: '60020', code: 'PERMISSION_DENIED' },
    { providerCode: '45009', code: 'RATE_LIMITED' }, { providerCode: '45006', code: 'RATE_LIMITED' },
    { providerCode: '40003', code: 'RESOURCE_NOT_FOUND' }, { providerCode: '46003', code: 'RESOURCE_NOT_FOUND' },
    { providerCode: '500', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '502', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '503', code: 'PROVIDER_UNAVAILABLE' },
  ] };
