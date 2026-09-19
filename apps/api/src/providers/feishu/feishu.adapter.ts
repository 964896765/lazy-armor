import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { FeishuAuthClient, feishuScopes } from './feishu-auth';
import { FeishuHttpClient } from './feishu-http.client';
import { feishuManifest } from './feishu-manifest';
import { normalizeFeishuCalendarEvent, normalizeFeishuResource, prepareFeishuAction, feishuWriteEvidence, type FeishuResourceKind } from './feishu-resource';

const base = 'https://open.feishu.cn/open-apis';

const SOURCE_KIND: Record<string, FeishuResourceKind> = {
  FEISHU_MESSAGE_EVENT_READ: 'FeishuMessage', FEISHU_DOC_READ: 'FeishuDoc', FEISHU_SHEET_READ: 'FeishuSheet',
  FEISHU_BITABLE_READ: 'FeishuBitable', FEISHU_APPROVAL_STATUS_READ: 'FeishuApproval',
};

export class FeishuProviderAdapter implements ProviderAdapter {
  constructor(private readonly auth: FeishuAuthClient, private readonly http: FeishuHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'feishu', name: '飞书 / Lark', description: 'Feishu/Lark app-tenant and user-delegated OAuth adapter; real-account acceptance is separate.',
    version: '0.1.0', connectorSdkVersion: '0.1.0', providerType: 'content', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'FEISHU_CALENDAR_READ', supportsRefresh: true, supportsRevoke: true, supportsPKCE: false, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: true, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(feishuManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.auth.start(input.request) };
    const token = await this.auth.exchange(input.request);
    const scopes = feishuScopes(token.credentials.scopes);
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: token.credentials.openId,
      grantedCapabilities: feishuManifest.capabilities.filter((c) => c.oauthScopes.length === 0 || c.oauthScopes.every((s) => scopes.includes(s))).map((c) => c.key) } };
  }
  refresh(input: CredentialRefreshRequest) { return this.auth.refresh(input); }
  async revoke(input: ConnectorRequest) {
    // Feishu user_access_token has no remote revoke endpoint; local credential
    // revocation (ConnectionsService + CredentialProvider) is authoritative.
    this.credentials(input);
  }
  async health(input?: ConnectorRequest) {
    if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const credential = this.credentials(input);
    await this.token(credential); // USER_OAUTH validates identity; APP_TENANT exchanges tenant token.
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() };
  }
  async read(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, false);
    const token = await this.token(credential);
    if (input.capability === 'FEISHU_CALENDAR_READ') {
      const calendarId = this.id(input.input.calendarId ?? credential.calendarId);
      const path = '/calendar/v4/calendars/' + encodeURIComponent(calendarId) + '/events';
      let events: Record<string, unknown>[];
      if (input.input.eventId) {
        events = [await this.api(path + '/' + this.id(input.input.eventId), token)];
      } else {
        const items = (await this.api(path + '?page_size=50', token)).items;
        events = Array.isArray(items) ? items as Record<string, unknown>[] : [];
      }
      if (events.length > 50) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      return { ok: true, data: { resources: events.map((event) => normalizeFeishuCalendarEvent(event, calendarId)),
        acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
    }
    const kind = SOURCE_KIND[input.capability];
    const resource = await this.readResource(kind, input.input, token, credential);
    return { ok: true, data: { resources: [resource],
      acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareFeishuAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    let created: Record<string, unknown>;
    if (desired.kind === 'message') {
      const body = { receive_id: desired.receiveId, msg_type: 'text', content: JSON.stringify({ text: desired.text }), uuid: desired.operationKey };
      created = await this.api('/im/v1/messages?receive_id_type=open_id', token, { method: 'POST', body: JSON.stringify(body) }, true);
      if (typeof created.message_id !== 'string' || !created.message_id) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else if (desired.kind === 'calendar') {
      const path = '/calendar/v4/calendars/' + encodeURIComponent(desired.calendarId) + '/events' + (desired.eventId ? '/' + this.id(desired.eventId) : '');
      const eventBody = { summary: desired.summary, start_time: { timestamp: String(Math.floor(Date.parse(desired.startAt) / 1000)) }, end_time: { timestamp: String(Math.floor(Date.parse(desired.endAt) / 1000)) } };
      const response = await this.api(path, token, { method: desired.eventId ? 'PATCH' : 'POST', body: JSON.stringify(eventBody) }, true);
      const event = (response.event ?? response) as Record<string, unknown>;
      if (typeof event.event_id !== 'string' || !event.event_id) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      created = event;
    } else if (desired.kind === 'doc') {
      const path = '/docx/v1/documents/' + encodeURIComponent(desired.documentId) + '/blocks/' + encodeURIComponent(desired.blockId) + '/children';
      const body = { children: [{ block_type: 2, text: { elements: [{ text_run: { content: desired.text + '\n<!-- lazy-armor-operation:' + desired.operationKey + ' -->' } }] } }] };
      created = await this.api(path, token, { method: 'POST', body: JSON.stringify(body) }, true);
    } else if (desired.kind === 'sheet') {
      const path = '/sheets/v2/spreadsheets/' + encodeURIComponent(desired.spreadsheetToken) + '/values_append?insertDataOption=OVERWRITE';
      created = await this.api(path, token, { method: 'POST', body: JSON.stringify({ value_range: { range: desired.range, values: desired.values } }) }, true);
    } else {
      const path = '/bitable/v1/apps/' + encodeURIComponent(desired.appToken) + '/tables/' + encodeURIComponent(desired.tableId) + '/records';
      const response = await this.api(path, token, { method: 'POST', body: JSON.stringify({ fields: desired.fields }) }, true);
      const record = (response.record ?? response) as Record<string, unknown>;
      if (typeof record.record_id !== 'string' || !record.record_id) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      created = record;
    }
    try { return this.readback(desired, created, credential, token); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareFeishuAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    const resourceId = String(input.input.resourceId ?? input.operationId ?? '');
    if (!resourceId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    return this.readback(desired, { resourceId }, credential, token);
  }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }

  private async readback(desired: ReturnType<typeof prepareFeishuAction>, created: Record<string, unknown>, credential: Record<string, string>, token: string) {
    const capability = desired.kind === 'message' ? 'FEISHU_MESSAGE_SEND' : desired.kind === 'calendar' ? (desired.eventId ? 'FEISHU_CALENDAR_UPDATE' : 'FEISHU_CALENDAR_CREATE')
      : desired.kind === 'doc' ? 'FEISHU_DOC_APPEND' : desired.kind === 'sheet' ? 'FEISHU_SHEET_APPEND' : 'FEISHU_BITABLE_RECORD_CREATE';
    let actual: Record<string, unknown>;
    if (desired.kind === 'message') {
      const messageId = String(created.message_id ?? created.resourceId ?? '');
      const result = await this.api('/im/v1/messages/' + this.id(messageId), token);
      const items = result.items as Record<string, unknown>[] | undefined;
      if (!Array.isArray(items) || items.length !== 1) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      actual = items[0];
    } else if (desired.kind === 'calendar') {
      const eventId = String(created.event_id ?? created.resourceId ?? desired.eventId ?? '');
      actual = await this.api('/calendar/v4/calendars/' + encodeURIComponent(desired.calendarId) + '/events/' + this.id(eventId), token);
    } else if (desired.kind === 'doc') {
      const documentId = String(created.document_id ?? created.resourceId ?? desired.documentId);
      const result = await this.api('/docx/v1/documents/' + encodeURIComponent(documentId) + '/blocks/' + encodeURIComponent(desired.blockId) + '/children?page_size=50', token);
      actual = { documentId, blocks: (result.items as Record<string, unknown>[] | undefined ?? []).map((b) => b) };
    } else if (desired.kind === 'sheet') {
      const spreadsheetToken = String(created.spreadsheet_token ?? created.resourceId ?? desired.spreadsheetToken);
      const result = await this.api('/sheets/v2/spreadsheets/' + encodeURIComponent(spreadsheetToken) + '/values/' + encodeURIComponent(desired.range), token);
      const range = (result.value_range ?? result) as Record<string, unknown>;
      actual = { spreadsheetToken, range: range.range, values: range.values };
    } else {
      const appToken = String(created.app_token ?? created.resourceId ?? desired.appToken);
      const recordId = String(created.record_id ?? '');
      if (!recordId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      const record = await this.api('/bitable/v1/apps/' + encodeURIComponent(appToken) + '/tables/' + encodeURIComponent(desired.tableId) + '/records/' + this.id(recordId), token);
      actual = (record.record ?? record) as Record<string, unknown>;
    }
    return { ok: true, data: { resourceId: String(actual.message_id ?? actual.messageId ?? actual.event_id ?? actual.record_id ?? created.resourceId ?? ''),
      verificationEvidence: feishuWriteEvidence(actual, desired, capability) } };
  }

  private async readResource(kind: FeishuResourceKind, input: Record<string, unknown>, token: string, credential: Record<string, string>): Promise<Record<string, unknown>> {
    const tenantKey = credential.tenantKey;
    if (kind === 'FeishuMessage') {
      const messageId = this.id(input.messageId);
      const result = await this.api('/im/v1/messages/' + messageId, token);
      const items = result.items as Record<string, unknown>[] | undefined;
      if (!Array.isArray(items) || items.length !== 1) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      const raw = items[0];
      return normalizeFeishuResource({ messageId: raw.message_id, chatId: raw.chat_id, msgType: raw.msg_type, content: raw.content, updatedAt: raw.create_time }, kind, tenantKey);
    }
    if (kind === 'FeishuDoc') {
      const documentId = this.id(input.documentId);
      const result = await this.api('/docx/v1/documents/' + encodeURIComponent(documentId), token);
      const doc = (result.document ?? result) as Record<string, unknown>;
      const children = await this.api('/docx/v1/documents/' + encodeURIComponent(documentId) + '/blocks/' + encodeURIComponent(documentId) + '/children?page_size=100', token);
      const blocks = (children.items as Record<string, unknown>[] | undefined ?? []).map((block) => feishuBlockText(block));
      const revision = typeof doc.revision === 'string' || typeof doc.revision === 'number' ? String(doc.revision) : undefined;
      return normalizeFeishuResource({ documentId: doc.document_id ?? documentId, title: doc.title, revision, blocks,
        updatedAt: revision && /^\d{9,13}$/.test(revision) ? new Date(revision.length > 10 ? Number(revision) : Number(revision) * 1000).toISOString() : new Date().toISOString() }, kind, tenantKey);
    }
    if (kind === 'FeishuSheet') {
      const tokenId = this.id(input.spreadsheetToken); const range = String(input.range ?? '');
      const result = await this.api('/sheets/v2/spreadsheets/' + encodeURIComponent(tokenId) + '/values/' + encodeURIComponent(range), token);
      const rangeData = (result.value_range ?? result) as Record<string, unknown>;
      return normalizeFeishuResource({ spreadsheetToken: tokenId, range: rangeData.range, values: rangeData.values, updatedAt: new Date().toISOString() }, kind, tenantKey);
    }
    if (kind === 'FeishuBitable') {
      const appToken = this.id(input.appToken); const tableId = this.id(input.tableId);
      const result = await this.api('/bitable/v1/apps/' + encodeURIComponent(appToken) + '/tables/' + encodeURIComponent(tableId) + '/records?page_size=50', token);
      const items = result.items as Record<string, unknown>[] | undefined;
      if (!Array.isArray(items) || items.length > 50) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      return normalizeFeishuResource({ appToken, tableId, records: items, updatedAt: new Date().toISOString() }, kind, tenantKey);
    }
    const instanceCode = this.id(input.instanceCode);
    const result = await this.api('/approval/v4/instances/' + encodeURIComponent(instanceCode), token);
    const instance = (result.instance ?? result) as Record<string, unknown>;
    return normalizeFeishuResource({ instanceCode, status: instance.status, form: instance.form, updatedAt: instance.update_time ?? new Date().toISOString() }, kind, tenantKey);
  }

  private credentials(input: ConnectorRequest) {
    const data = input.credentials?.data;
    if (!data) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    if (data.tokenMode === 'USER_OAUTH') {
      if (!data.accessToken || !data.tenantKey) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    if (data.tokenMode === 'APP_TENANT') {
      if (!data.appId || !data.appSecret) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
  }
  private async token(credential: Record<string, string>): Promise<string> {
    if (credential.tokenMode === 'USER_OAUTH') { await this.auth.identity(credential); return credential.accessToken; }
    return (await this.auth.tenantAccessToken(credential.appId, credential.appSecret)).token;
  }
  private assertCapability(input: ConnectorRequest, credential: Record<string, string>, write: boolean) {
    const definition = feishuManifest.capabilities.find((c) => c.key === input.capability);
    if (!definition || (definition.operation === 'execute') !== write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if (credential.tokenMode === 'USER_OAUTH') {
      const scopes = new Set(feishuScopes(credential.scopes));
      if (!definition.oauthScopes.every((scope) => scopes.has(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
    }
  }
  private id(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_\-.:]{1,200}$/.test(value)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return value;
  }
  private async api(path: string, token: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    return this.http.object(base + path, { ...init, headers: { authorization: 'Bearer ' + token, ...init.headers } }, write);
  }
}

function feishuBlockText(block: Record<string, unknown>): Record<string, unknown> {
  const text = extractFeishuText(block.text ?? block.heading1 ?? block.heading2 ?? block.heading3 ?? block.bullet ?? block.ordered);
  return { blockId: block.block_id, blockType: block.block_type, text };
}

function extractFeishuText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractFeishuText).join('');
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.content === 'string') return record.content;
    if (Array.isArray(record.elements)) return record.elements.map(extractFeishuText).join('');
    if (record.text_run && typeof record.text_run === 'object') return extractFeishuText(record.text_run);
    if (Array.isArray(record.children)) return record.children.map(extractFeishuText).join('');
  }
  return '';
}
