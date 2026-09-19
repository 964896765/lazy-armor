import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { WeComAuthClient, wecomScopes } from './wecom-auth';
import { WeComHttpClient } from './wecom-http.client';
import { wecomManifest } from './wecom-manifest';
import { normalizeWeComCalendarEvent, normalizeWeComResource, prepareWeComAction, wecomWriteEvidence, type WeComResourceKind } from './wecom-resource';

const base = 'https://qyapi.weixin.qq.com';

const SOURCE_KIND: Record<string, WeComResourceKind> = {
  WECOM_APPROVAL_STATUS_READ: 'WeComApproval', WECOM_APP_MESSAGE_EVENT: 'WeComMessage',
};

export class WeComProviderAdapter implements ProviderAdapter {
  constructor(private readonly auth: WeComAuthClient, private readonly http: WeComHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'wecom', name: '企业微信 / WeCom', description: 'WeCom corp/app and member-delegated OAuth adapter; real-account acceptance is separate.',
    version: '0.1.0', connectorSdkVersion: '0.1.0', providerType: 'content', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'WECOM_CALENDAR_READ', supportsRefresh: true, supportsRevoke: true, supportsPKCE: false, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: true, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(wecomManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.auth.start(input.request) };
    const token = await this.auth.exchange(input.request);
    const scopes = wecomScopes(token.credentials.scopes);
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: token.credentials.userId,
      grantedCapabilities: wecomManifest.capabilities.filter((c) => c.oauthScopes.length === 0 || c.oauthScopes.every((s) => scopes.includes(s))).map((c) => c.key) } };
  }
  refresh(input: CredentialRefreshRequest) { return this.auth.refresh(input); }
  async revoke(input: ConnectorRequest) {
    // WeCom has no remote token revoke endpoint; local credential revocation
    // (ConnectionsService + CredentialProvider) is authoritative.
    this.credentials(input);
  }
  async health(input?: ConnectorRequest) {
    if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const credential = this.credentials(input);
    await this.token(credential);
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() };
  }
  async read(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, false);
    const token = await this.token(credential);
    if (input.capability === 'WECOM_CALENDAR_READ') {
      const calendarId = this.id(input.input.calendarId ?? credential.calendarId);
      let events: Record<string, unknown>[];
      if (input.input.eventId) {
        const result = await this.api('/cgi-bin/oa/schedule/get', token, { method: 'POST', body: JSON.stringify({ schedule_id: this.id(input.input.eventId) }) }, true);
        events = [normalizeWeComCalendarEvent((result.schedule ?? result) as Record<string, unknown>, calendarId)];
      } else {
        const result = await this.api('/cgi-bin/oa/schedule/get_by_calendar', token, { method: 'POST', body: JSON.stringify({ cal_id: calendarId, offset: 0, limit: 50 }) }, true);
        const list = result.schedule_list as Record<string, unknown>[] | undefined;
        events = (Array.isArray(list) ? list : []).map((event) => normalizeWeComCalendarEvent(event, calendarId));
      }
      if (events.length > 50) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      return { ok: true, data: { resources: events,
        acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
    }
    const kind = SOURCE_KIND[input.capability];
    const resource = await this.readResource(kind, input.input, token, credential);
    return { ok: true, data: { resources: [resource],
      acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareWeComAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    let created: Record<string, unknown>;
    if (desired.kind === 'message') {
      created = await this.api('/cgi-bin/message/send', token, { method: 'POST', body: JSON.stringify({
        touser: desired.touser, msgtype: 'text', agentid: Number(credential.agentId), text: { content: desired.text } }) }, true);
      if (typeof created.msgid !== 'string' && typeof created.msgId !== 'string') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else if (desired.kind === 'calendar') {
      const body = desired.eventId
        ? { schedule_id: desired.eventId, summary: desired.summary, start_time: Math.floor(Date.parse(desired.startAt) / 1000), end_time: Math.floor(Date.parse(desired.endAt) / 1000) }
        : { cal_id: desired.calendarId, summary: desired.summary, start_time: Math.floor(Date.parse(desired.startAt) / 1000), end_time: Math.floor(Date.parse(desired.endAt) / 1000) };
      const path = desired.eventId ? '/cgi-bin/oa/schedule/update' : '/cgi-bin/oa/schedule/add';
      created = await this.api(path, token, { method: 'POST', body: JSON.stringify(body) }, true);
      if (typeof created.schedule_id !== 'string' && typeof created.scheduleId !== 'string') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else {
      created = await this.api('/cgi-bin/oa/applyevent', token, { method: 'POST', body: JSON.stringify({
        creator_userid: desired.creatorUserid, template_id: desired.templateId, apply_data: desired.formValues }) }, true);
      if (typeof created.sp_no !== 'string' && typeof created.spNo !== 'string') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    }
    try { return this.readback(desired, created, credential, token); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareWeComAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    const resourceId = String(input.input.resourceId ?? input.operationId ?? '');
    if (!resourceId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    return this.readback(desired, { resourceId }, credential, token);
  }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }

  private async readback(desired: ReturnType<typeof prepareWeComAction>, created: Record<string, unknown>, credential: Record<string, string>, token: string) {
    const capability = desired.kind === 'message' ? 'WECOM_APP_MESSAGE_SEND' : desired.kind === 'calendar' ? (desired.eventId ? 'WECOM_CALENDAR_UPDATE' : 'WECOM_CALENDAR_CREATE') : 'WECOM_APPROVAL_PREPARE';
    let actual: Record<string, unknown>;
    if (desired.kind === 'message') {
      const msgid = String(created.msgid ?? created.msgId ?? created.resourceId ?? '');
      actual = await this.api('/cgi-bin/message/get', token, { method: 'POST', body: JSON.stringify({ msgid: this.id(msgid) }) }, true);
    } else if (desired.kind === 'calendar') {
      const eventId = String(created.schedule_id ?? created.scheduleId ?? created.resourceId ?? desired.eventId ?? '');
      const result = await this.api('/cgi-bin/oa/schedule/get', token, { method: 'POST', body: JSON.stringify({ schedule_id: this.id(eventId) }) }, true);
      actual = (result.schedule ?? result) as Record<string, unknown>;
    } else {
      const spNo = String(created.sp_no ?? created.spNo ?? created.resourceId ?? '');
      const result = await this.api('/cgi-bin/oa/getapprovaldetail', token, { method: 'POST', body: JSON.stringify({ sp_no: this.id(spNo) }) }, true);
      actual = (result.info ?? result) as Record<string, unknown>;
    }
    return { ok: true, data: { resourceId: String(actual.msgid ?? actual.msgId ?? actual.schedule_id ?? actual.scheduleId ?? actual.sp_no ?? actual.spNo ?? created.resourceId ?? ''),
      verificationEvidence: wecomWriteEvidence(actual, desired, capability) } };
  }

  private async readResource(kind: WeComResourceKind, input: Record<string, unknown>, token: string, credential: Record<string, string>): Promise<Record<string, unknown>> {
    const corpId = credential.corpId;
    if (kind === 'WeComApproval') {
      const spNo = this.id(input.spNo ?? input.instanceId);
      const result = await this.api('/cgi-bin/oa/getapprovaldetail', token, { method: 'POST', body: JSON.stringify({ sp_no: spNo }) }, true);
      const info = (result.info ?? result) as Record<string, unknown>;
      return normalizeWeComResource({ spNo, status: info.sp_status ?? info.status, form: info.apply_data ?? info.form, updatedAt: info.update_time ?? new Date().toISOString() }, kind, corpId);
    }
    const msgid = this.id(input.msgId ?? input.messageId);
    const raw = await this.api('/cgi-bin/message/get', token, { method: 'POST', body: JSON.stringify({ msgid }) }, true);
    return normalizeWeComResource({ msgId: msgid, fromUser: raw.fromUser, content: raw.content, createTime: raw.create_time ?? new Date().toISOString() }, kind, corpId);
  }

  private credentials(input: ConnectorRequest) {
    const data = input.credentials?.data;
    if (!data) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    if (data.tokenMode === 'USER_OAUTH') {
      if (!data.accessToken || !data.corpId || !data.userId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    if (data.tokenMode === 'APP_TENANT') {
      if (!data.corpId || !data.agentId || !data.appSecret) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
  }
  private async token(credential: Record<string, string>): Promise<string> {
    if (credential.tokenMode === 'USER_OAUTH') { await this.auth.identity(credential); return credential.accessToken; }
    return (await this.auth.getAccessToken(credential.corpId, credential.appSecret)).token;
  }
  private assertCapability(input: ConnectorRequest, credential: Record<string, string>, write: boolean) {
    const definition = wecomManifest.capabilities.find((c) => c.key === input.capability);
    if (!definition || (definition.operation === 'execute') !== write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if (credential.tokenMode === 'USER_OAUTH') {
      const scopes = new Set(wecomScopes(credential.scopes));
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
