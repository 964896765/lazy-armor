import { candidateCapability, providerDefinitionHash, type OfficialEvidenceRevision, type ProviderCapabilityManifest, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

// DingTalk China-first provider manifest. Reuses the single first-party chain:
// Provider -> Connection -> Capability Manifest -> Provider Runtime -> Source
// Acquisition -> Observation -> Candidate -> Truth -> Strategy/Plan -> Risk/Approval
// -> Capability Resolver -> Execution -> Action Adapter -> Provider API -> Verification
// -> Reconciliation -> Audit. No second engine is introduced here.

export const DINGTALK_SOURCE_CAPABILITIES = ['DINGTALK_MESSAGE_EVENT_READ', 'DINGTALK_CALENDAR_READ', 'DINGTALK_APPROVAL_STATUS_READ', 'DINGTALK_WORK_NOTIFICATION_EVENT'] as const;
export const DINGTALK_ACTION_CAPABILITIES = ['DINGTALK_MESSAGE_SEND', 'DINGTALK_CALENDAR_CREATE', 'DINGTALK_CALENDAR_UPDATE', 'DINGTALK_DING_SEND', 'DINGTALK_APPROVAL_PREPARE'] as const;
export const DINGTALK_CAPABILITIES = [...DINGTALK_SOURCE_CAPABILITIES, ...DINGTALK_ACTION_CAPABILITIES] as const;

export const DINGTALK_SCOPES = {
  identity: 'openid',
  corpId: 'corpid',
  messageEvent: 'robot:message:event:read',
  messageWrite: 'robot:message:send',
  calendarRead: 'calendar:read',
  calendarWrite: 'calendar:write',
  dingWrite: 'ding:send',
  workflowRead: 'workflow:read',
  workflowWrite: 'workflow:write',
} as const;

export const DINGTALK_EXPLICIT_DENIALS = ['DELETE_CALENDAR', 'BULK_MESSAGE', 'ADMIN_PERMISSION_CHANGE', 'APPROVAL_FORCE_DECISION'] as const;

export const AWAITING_DINGTALK_CREDENTIALS = 'AWAITING_DINGTALK_CREDENTIALS';
export const AWAITING_DINGTALK_OAUTH_EVIDENCE = 'AWAITING_DINGTALK_OAUTH_EVIDENCE';
export const AWAITING_DINGTALK_EVENT_EVIDENCE = 'AWAITING_DINGTALK_EVENT_EVIDENCE';

const uri = 'https://open.dingtalk.com/document/';
const reviewedAt = '2026-09-19T00:00:00.000Z';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: '钉钉开放平台公开文档中的 capability 声明、免登 authCode 交换、事件订阅与读写边界已核对；真实企业应用凭证、免登验收与事件验收分别保持 ' + AWAITING_DINGTALK_CREDENTIALS + ' / ' + AWAITING_DINGTALK_OAUTH_EVIDENCE + ' / ' + AWAITING_DINGTALK_EVENT_EVIDENCE + '，不得标记为 VERIFIED。' };

interface DingTalkCapabilitySpec {
  key: typeof DINGTALK_CAPABILITIES[number];
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

const SOURCE_SPECS: DingTalkCapabilitySpec[] = [
  { key: 'DINGTALK_MESSAGE_EVENT_READ', name: '读取机器人可见消息事件', resource: 'DingTalkMessage', operation: 'read', riskLevel: 'R1', scopes: [DINGTALK_SCOPES.identity, DINGTALK_SCOPES.messageEvent],
    resourceHint: 'DingTalkMessage', readableFields: ['messageId', 'corpId', 'userId', 'content', 'createAt'], writableFields: [],
    purpose: 'BOT_VISIBLE_MESSAGE_EVENT', realtimeModes: ['WEBHOOK'], actionMode: 'OBSERVE', sensitiveFields: ['content'] },
  { key: 'DINGTALK_CALENDAR_READ', name: '读取钉钉日历', resource: 'CalendarEvent', operation: 'read', riskLevel: 'R1', scopes: [DINGTALK_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end', 'attendees', 'status'], writableFields: [],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'OBSERVE', sensitiveFields: ['title', 'attendees'] },
  { key: 'DINGTALK_APPROVAL_STATUS_READ', name: '读取钉钉审批状态', resource: 'DingTalkApproval', operation: 'read', riskLevel: 'R1', scopes: [DINGTALK_SCOPES.workflowRead],
    resourceHint: 'DingTalkApproval', readableFields: ['instanceId', 'status', 'form', 'updatedAt'], writableFields: [],
    purpose: 'APP_AUTHORIZED_APPROVAL_RESOURCE', realtimeModes: ['POLL'], actionMode: 'OBSERVE', sensitiveFields: ['form'] },
  { key: 'DINGTALK_WORK_NOTIFICATION_EVENT', name: '读取工作通知事件', resource: 'DingTalkWorkNotification', operation: 'read', riskLevel: 'R1', scopes: [DINGTALK_SCOPES.identity, DINGTALK_SCOPES.messageEvent],
    resourceHint: 'DingTalkWorkNotification', readableFields: ['messageId', 'corpId', 'userId', 'content', 'createAt'], writableFields: [],
    purpose: 'APP_AUTHORIZED_WORK_NOTIFICATION_EVENT', realtimeModes: ['WEBHOOK'], actionMode: 'OBSERVE', sensitiveFields: ['content'] },
];

const ACTION_SPECS: DingTalkCapabilitySpec[] = [
  { key: 'DINGTALK_MESSAGE_SEND', name: '以应用身份发送消息', resource: 'DingTalkMessage', operation: 'execute', riskLevel: 'R3', scopes: [DINGTALK_SCOPES.messageWrite],
    resourceHint: 'DingTalkMessage', readableFields: ['messageId', 'corpId', 'content'], writableFields: ['receiveId', 'robotCode', 'text'],
    purpose: 'APP_AUTHORIZED_MESSAGE_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['text'] },
  { key: 'DINGTALK_CALENDAR_CREATE', name: '创建钉钉日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [DINGTALK_SCOPES.calendarWrite, DINGTALK_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['summary'] },
  { key: 'DINGTALK_CALENDAR_UPDATE', name: '更新钉钉日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [DINGTALK_SCOPES.calendarWrite, DINGTALK_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'eventId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['summary'] },
  { key: 'DINGTALK_DING_SEND', name: '发送钉钉 DING 提醒', resource: 'DingTalkDing', operation: 'execute', riskLevel: 'R3', scopes: [DINGTALK_SCOPES.dingWrite],
    resourceHint: 'DingTalkDing', readableFields: ['dingId', 'userIds'], writableFields: ['userIds', 'text'],
    purpose: 'APP_AUTHORIZED_DING_RESOURCE', realtimeModes: ['POLL'], actionMode: 'EXECUTE', sensitiveFields: ['text'] },
  { key: 'DINGTALK_APPROVAL_PREPARE', name: '准备钉钉审批实例', resource: 'DingTalkApproval', operation: 'execute', riskLevel: 'R3', scopes: [DINGTALK_SCOPES.workflowWrite, DINGTALK_SCOPES.workflowRead],
    resourceHint: 'DingTalkApproval', readableFields: ['instanceId', 'processCode', 'status'], writableFields: ['originatorUserId', 'processCode', 'formValues'],
    purpose: 'APP_AUTHORIZED_APPROVAL_RESOURCE', realtimeModes: ['POLL'], actionMode: 'PREPARE', sensitiveFields: ['formValues'] },
];

function capability(spec: DingTalkCapabilitySpec) {
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

export const dingtalkManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'dingtalk', providerName: '钉钉 / DingTalk', revision: 1, providerReview: 'VERIFIED',
  accountTypes: ['tenant', 'user'], sourceModes: ['OFFICIAL_API', 'WEBHOOK'], actionModes: ['OBSERVE', 'PREPARE', 'EXECUTE'],
  rateLimitPolicy: 'Application request budget (tenant/connection weighted); not an assertion of official DingTalk quota. Real credentials remain AWAITING_DINGTALK_CREDENTIALS.',
  evidence: [evidence], explicitDenials: [],
  capabilities: [...SOURCE_SPECS, ...ACTION_SPECS].map(capability),
};

export const dingtalkEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'dingtalk', key: 'dingtalk-open-platform-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, modes: ['APP_TENANT', 'USER_AUTHCODE'], scopes: DINGTALK_SCOPES,
    methods: ['v1.0/oauth2/accessToken', 'v1.0/oauth2/userAccessToken', 'v1.0/contact/users/me', 'v1.0/robot/oToMessages/batchSend', 'v1.0/calendar', 'v1.0/workflow/processInstances'],
    writeRetry: 'NEVER', reconciliation: 'READ_ONLY_BOUNDED_MARKER_LOOKUP', credentialAcceptance: AWAITING_DINGTALK_CREDENTIALS,
    oauthAcceptance: AWAITING_DINGTALK_OAUTH_EVIDENCE, eventAcceptance: AWAITING_DINGTALK_EVENT_EVIDENCE }) };

const capabilityUnits = Object.fromEntries(DINGTALK_CAPABILITIES.map((key) => [key, key.startsWith('DINGTALK_MESSAGE') || key.includes('CALENDAR') ? 5 : 4])) as Record<typeof DINGTALK_CAPABILITIES[number], number>;

export const dingtalkPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'dingtalk', revision: 1, manifestRevision: 1,
  evidence: { key: dingtalkEvidence.key, revision: 1, hash: providerDefinitionHash(dingtalkEvidence) },
  rateLimit: { providerRequests: 100, connectionRequests: 50, windowSeconds: 60 },
  quota: { providerUnits: 500, connectionUnits: 200, windowSeconds: 60, capabilityUnits },
  retry: { maxReadAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: DINGTALK_ACTION_CAPABILITIES.map((capabilityKey) => ({ key: `dingtalk.${capabilityKey.toLowerCase()}.readback`, revision: '1',
    providerKey: 'dingtalk', capabilityKey, methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [
    { providerCode: '40014', code: 'AUTH_EXPIRED' }, { providerCode: '40001', code: 'AUTH_EXPIRED' }, { providerCode: '40016', code: 'AUTH_EXPIRED' },
    { providerCode: '88', code: 'AUTH_EXPIRED' },
    { providerCode: '60011', code: 'PERMISSION_DENIED' }, { providerCode: '60012', code: 'PERMISSION_DENIED' }, { providerCode: '60010', code: 'PERMISSION_DENIED' },
    { providerCode: '90002', code: 'RATE_LIMITED' }, { providerCode: '90018', code: 'RATE_LIMITED' },
    { providerCode: '40003', code: 'RESOURCE_NOT_FOUND' }, { providerCode: '60008', code: 'RESOURCE_NOT_FOUND' },
    { providerCode: '500', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '502', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '503', code: 'PROVIDER_UNAVAILABLE' },
  ] };
