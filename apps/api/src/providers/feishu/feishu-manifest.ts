import { candidateCapability, providerDefinitionHash, type OfficialEvidenceRevision, type ProviderCapabilityManifest, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';

// Feishu / Lark China-first provider manifest. The first-party chain is unchanged:
// Provider -> Connection -> Capability Manifest -> Provider Runtime -> Source
// Acquisition -> Observation -> Candidate -> Truth -> Strategy/Plan -> Risk/Approval
// -> Capability Resolver -> Execution -> Action Adapter -> Provider API -> Verification
// -> Reconciliation -> Audit. This file only declares the Feishu slice of that chain.

export const FEISHU_SOURCE_CAPABILITIES = ['FEISHU_MESSAGE_EVENT_READ', 'FEISHU_CALENDAR_READ', 'FEISHU_DOC_READ', 'FEISHU_SHEET_READ', 'FEISHU_BITABLE_READ', 'FEISHU_APPROVAL_STATUS_READ'] as const;
export const FEISHU_ACTION_CAPABILITIES = ['FEISHU_MESSAGE_SEND', 'FEISHU_CALENDAR_CREATE', 'FEISHU_CALENDAR_UPDATE', 'FEISHU_DOC_APPEND', 'FEISHU_SHEET_APPEND', 'FEISHU_BITABLE_RECORD_CREATE'] as const;
export const FEISHU_CAPABILITIES = [...FEISHU_SOURCE_CAPABILITIES, ...FEISHU_ACTION_CAPABILITIES] as const;

export const FEISHU_SCOPES = {
  messageRead: 'im:message',
  messageWrite: 'im:message:send_as_bot',
  calendarRead: 'calendar:calendar',
  calendarWrite: 'calendar:calendar:write',
  docRead: 'docx:document',
  docWrite: 'docx:document:write',
  sheetRead: 'sheets:sheet',
  sheetWrite: 'sheets:sheet:write',
  bitableRead: 'bitable:app',
  bitableWrite: 'bitable:app:write',
  approvalRead: 'approval:approval:readonly',
  contactUser: 'contact:user.base:readonly',
} as const;

export const FEISHU_EXPLICIT_DENIALS = ['DELETE_DOC', 'DELETE_CALENDAR', 'BULK_MESSAGE', 'BULK_MEMBER_OPERATION', 'APPROVAL_FORCE_DECISION', 'ADMIN_PERMISSION_CHANGE'] as const;

export const AWAITING_FEISHU_CREDENTIALS = 'AWAITING_FEISHU_CREDENTIALS';
export const AWAITING_FEISHU_OAUTH_EVIDENCE = 'AWAITING_FEISHU_OAUTH_EVIDENCE';
export const AWAITING_FEISHU_EVENT_EVIDENCE = 'AWAITING_FEISHU_EVENT_EVIDENCE';

const uri = 'https://open.feishu.cn/document/';
const reviewedAt = '2026-09-19T00:00:00.000Z';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt,
  summary: 'Feishu/Lark 开放平台公开文档中的 capability 声明、OAuth scope、事件订阅与读写边界已核对；真实 App 凭证、OAuth 验收与事件验收分别保持 ' + AWAITING_FEISHU_CREDENTIALS + ' / ' + AWAITING_FEISHU_OAUTH_EVIDENCE + ' / ' + AWAITING_FEISHU_EVENT_EVIDENCE + '，不得标记为 VERIFIED。' };

interface FeishuCapabilitySpec {
  key: typeof FEISHU_CAPABILITIES[number];
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
  sensitiveFields: string[];
}

const SOURCE_SPECS: FeishuCapabilitySpec[] = [
  { key: 'FEISHU_MESSAGE_EVENT_READ', name: '读取机器人可见消息事件', resource: 'FeishuMessage', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.messageRead],
    resourceHint: 'FeishuMessage', readableFields: ['messageId', 'chatId', 'senderId', 'content', 'msgType'], writableFields: [],
    purpose: 'BOT_VISIBLE_MESSAGE_EVENT', realtimeModes: ['WEBHOOK'], sensitiveFields: ['content'] },
  { key: 'FEISHU_CALENDAR_READ', name: '读取飞书日历', resource: 'CalendarEvent', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end', 'attendees', 'status'], writableFields: [],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['title', 'attendees'] },
  { key: 'FEISHU_DOC_READ', name: '读取飞书文档', resource: 'FeishuDoc', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.docRead],
    resourceHint: 'FeishuDoc', readableFields: ['documentId', 'title', 'blocks'], writableFields: [],
    purpose: 'APP_AUTHORIZED_DOC_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['blocks'] },
  { key: 'FEISHU_SHEET_READ', name: '读取飞书表格', resource: 'FeishuSheet', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.sheetRead],
    resourceHint: 'FeishuSheet', readableFields: ['spreadsheetToken', 'range', 'values'], writableFields: [],
    purpose: 'APP_AUTHORIZED_SHEET_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['values'] },
  { key: 'FEISHU_BITABLE_READ', name: '读取飞书多维表格', resource: 'FeishuBitable', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.bitableRead],
    resourceHint: 'FeishuBitable', readableFields: ['appToken', 'tableId', 'records'], writableFields: [],
    purpose: 'APP_AUTHORIZED_BITABLE_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['records'] },
  { key: 'FEISHU_APPROVAL_STATUS_READ', name: '读取飞书审批状态', resource: 'FeishuApproval', operation: 'read', riskLevel: 'R1', scopes: [FEISHU_SCOPES.approvalRead],
    resourceHint: 'FeishuApproval', readableFields: ['instanceCode', 'status', 'form', 'updatedAt'], writableFields: [],
    purpose: 'APP_AUTHORIZED_APPROVAL_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['form'] },
];

const ACTION_SPECS: FeishuCapabilitySpec[] = [
  { key: 'FEISHU_MESSAGE_SEND', name: '以应用身份发送消息', resource: 'FeishuMessage', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.messageWrite, FEISHU_SCOPES.messageRead],
    resourceHint: 'FeishuMessage', readableFields: ['messageId', 'chatId', 'content'], writableFields: ['receiveId', 'content', 'msgType'],
    purpose: 'APP_AUTHORIZED_MESSAGE_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['content'] },
  { key: 'FEISHU_CALENDAR_CREATE', name: '创建飞书日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.calendarWrite, FEISHU_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['summary'] },
  { key: 'FEISHU_CALENDAR_UPDATE', name: '更新飞书日历事件', resource: 'CalendarEvent', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.calendarWrite, FEISHU_SCOPES.calendarRead],
    resourceHint: 'CalendarEvent', readableFields: ['eventId', 'calendarId', 'title', 'start', 'end'], writableFields: ['calendarId', 'eventId', 'summary', 'start', 'end'],
    purpose: 'APP_AUTHORIZED_CALENDAR_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['summary'] },
  { key: 'FEISHU_DOC_APPEND', name: '向飞书文档追加内容', resource: 'FeishuDoc', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.docWrite, FEISHU_SCOPES.docRead],
    resourceHint: 'FeishuDoc', readableFields: ['documentId', 'blockId'], writableFields: ['documentId', 'blockId', 'text'],
    purpose: 'APP_AUTHORIZED_DOC_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['text'] },
  { key: 'FEISHU_SHEET_APPEND', name: '向飞书表格追加数据', resource: 'FeishuSheet', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.sheetWrite, FEISHU_SCOPES.sheetRead],
    resourceHint: 'FeishuSheet', readableFields: ['spreadsheetToken', 'range'], writableFields: ['spreadsheetToken', 'range', 'values'],
    purpose: 'APP_AUTHORIZED_SHEET_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['values'] },
  { key: 'FEISHU_BITABLE_RECORD_CREATE', name: '创建飞书多维表格记录', resource: 'FeishuBitable', operation: 'execute', riskLevel: 'R3', scopes: [FEISHU_SCOPES.bitableWrite, FEISHU_SCOPES.bitableRead],
    resourceHint: 'FeishuBitable', readableFields: ['appToken', 'tableId', 'recordId'], writableFields: ['appToken', 'tableId', 'fields'],
    purpose: 'APP_AUTHORIZED_BITABLE_RESOURCE', realtimeModes: ['POLL'], sensitiveFields: ['fields'] },
];

function capability(spec: FeishuCapabilitySpec) {
  const write = spec.operation === 'execute';
  return { ...candidateCapability({ key: spec.key, name: spec.name, resource: spec.resource, operation: spec.operation,
    riskLevel: spec.riskLevel, sourceModes: ['OFFICIAL_API', 'WEBHOOK'] }),
    providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'VERIFIED' as const,
    oauthScopes: spec.scopes, accountTypes: ['tenant', 'user'], realtimeModes: spec.realtimeModes,
    actionModes: [write ? 'EXECUTE' as const : 'OBSERVE' as const],
    verificationMethods: write ? ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'] : ['SOURCE_EVIDENCE'], evidence: [evidence],
    dataBoundary: { resources: [spec.resource], readableFields: spec.readableFields, writableFields: spec.writableFields,
      purpose: [spec.purpose], sensitiveFields: spec.sensitiveFields, retentionDays: 30 },
    explicitDenials: [], sideEffectContract: { sideEffect: write, supportsIdempotencyKey: false, supportsOperationLookup: write,
      retrySafety: 'unsafe' as const, idempotencyKeyMaxLength: 128, idempotencySemantics: 'body' as const } };
}

export const feishuManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'feishu', providerName: '飞书 / Lark', revision: 1, providerReview: 'VERIFIED',
  accountTypes: ['tenant', 'user'], sourceModes: ['OFFICIAL_API', 'WEBHOOK'], actionModes: ['OBSERVE', 'EXECUTE'],
  rateLimitPolicy: 'Application request budget (tenant/connection weighted); not an assertion of official Feishu tenant quota. Real credentials remain AWAITING_FEISHU_CREDENTIALS.',
  evidence: [evidence], explicitDenials: [],
  capabilities: [...SOURCE_SPECS, ...ACTION_SPECS].map(capability),
};

export const feishuEvidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: 'feishu', key: 'feishu-open-platform-review', revision: 1,
  kind: 'OFFICIAL_DOC', status: 'VERIFIED', uri, summary: evidence.summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, modes: ['APP_TENANT', 'USER_DELEGATED_OAUTH'], scopes: FEISHU_SCOPES,
    methods: ['auth.v3.tenant_access_token.internal', 'authen.v2.oauth.token', 'authen.v1.user_info', 'im.v1.messages', 'calendar.v4.events', 'docx.v1.documents', 'sheets.v2.spreadsheets', 'bitable.v1.records', 'approval.v4.instances'],
    writeRetry: 'NEVER', reconciliation: 'READ_ONLY_BOUNDED_MARKER_LOOKUP', credentialAcceptance: AWAITING_FEISHU_CREDENTIALS,
    oauthAcceptance: AWAITING_FEISHU_OAUTH_EVIDENCE, eventAcceptance: AWAITING_FEISHU_EVENT_EVIDENCE }) };

const capabilityUnits = Object.fromEntries(FEISHU_CAPABILITIES.map((key) => [key, key.startsWith('FEISHU_MESSAGE') || key.includes('CALENDAR') ? 5 : 4])) as Record<typeof FEISHU_CAPABILITIES[number], number>;

export const feishuPolicy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: 'feishu', revision: 1, manifestRevision: 1,
  evidence: { key: feishuEvidence.key, revision: 1, hash: providerDefinitionHash(feishuEvidence) },
  rateLimit: { providerRequests: 100, connectionRequests: 50, windowSeconds: 60 },
  quota: { providerUnits: 500, connectionUnits: 200, windowSeconds: 60, capabilityUnits },
  retry: { maxReadAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
  health: { validForSeconds: 300, timeoutMs: 10000 },
  verificationPolicies: FEISHU_ACTION_CAPABILITIES.map((capabilityKey) => ({ key: `feishu.${capabilityKey.toLowerCase()}.readback`, revision: '1',
    providerKey: 'feishu', capabilityKey, methods: ['PROVIDER_RESPONSE', 'OPERATION_LOOKUP'], timeoutMs: 10000, maxAttempts: 5, expiresAfterMs: 86400000,
    predicates: [{ path: ['verificationEvidence', 'matched'], equals: true, result: 'SUCCEEDED' }] })),
  errorMapping: [
    { providerCode: '99991661', code: 'AUTH_EXPIRED' }, { providerCode: '99991663', code: 'AUTH_EXPIRED' }, { providerCode: '99991672', code: 'AUTH_EXPIRED' },
    { providerCode: '99991668', code: 'AUTH_REVOKED' }, { providerCode: '99991671', code: 'AUTH_REVOKED' },
    { providerCode: '10003', code: 'PERMISSION_DENIED' }, { providerCode: '99991400', code: 'PERMISSION_DENIED' }, { providerCode: '99991669', code: 'PERMISSION_DENIED' },
    { providerCode: '99991403', code: 'RATE_LIMITED' }, { providerCode: '1254046', code: 'RESOURCE_NOT_FOUND' }, { providerCode: '1254047', code: 'RESOURCE_NOT_FOUND' },
    { providerCode: '500', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '501', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '502', code: 'PROVIDER_UNAVAILABLE' }, { providerCode: '503', code: 'PROVIDER_UNAVAILABLE' },
  ] };
