import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { DingTalkAuthClient, dingtalkScopes } from './dingtalk-auth';
import { DingTalkHttpClient } from './dingtalk-http.client';
import { dingtalkManifest } from './dingtalk-manifest';
import { dingtalkWriteEvidence, normalizeDingTalkCalendarEvent, normalizeDingTalkResource, prepareDingTalkAction, type DingTalkResourceKind } from './dingtalk-resource';

const base = 'https://api.dingtalk.com';

const SOURCE_KIND: Record<string, DingTalkResourceKind> = {
  DINGTALK_MESSAGE_EVENT_READ: 'DingTalkMessage', DINGTALK_APPROVAL_STATUS_READ: 'DingTalkApproval',
  DINGTALK_WORK_NOTIFICATION_EVENT: 'DingTalkWorkNotification',
};

export class DingTalkProviderAdapter implements ProviderAdapter {
  constructor(private readonly auth: DingTalkAuthClient, private readonly http: DingTalkHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'dingtalk', name: '钉钉 / DingTalk', description: 'DingTalk enterprise-app and user authCode adapter; real-account acceptance is separate.',
    version: '0.1.0', connectorSdkVersion: '0.1.0', providerType: 'content', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'DINGTALK_CALENDAR_READ', supportsRefresh: true, supportsRevoke: true, supportsPKCE: false, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: true, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(dingtalkManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.auth.start(input.request) };
    const token = await this.auth.exchange(input.request);
    const scopes = dingtalkScopes(token.credentials.scopes);
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: token.credentials.openId || token.credentials.corpId,
      grantedCapabilities: dingtalkManifest.capabilities.filter((c) => c.oauthScopes.length === 0 || c.oauthScopes.every((s) => scopes.includes(s))).map((c) => c.key) } };
  }
  refresh(input: CredentialRefreshRequest) { return this.auth.refresh(input); }
  async revoke(input: ConnectorRequest) {
    // DingTalk has no remote token revoke endpoint; local credential revocation
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
    if (input.capability === 'DINGTALK_CALENDAR_READ') {
      const calendarId = this.id(input.input.calendarId ?? credential.calendarId);
      let events: Record<string, unknown>[];
      if (input.input.eventId) {
        events = [await this.api('/v1.0/calendar/events/' + encodeURIComponent(this.id(input.input.eventId)), token)];
      } else {
        const result = await this.api('/v1.0/calendar/calendars/' + encodeURIComponent(calendarId) + '/events?maxResults=50', token);
        events = Array.isArray(result.events) ? result.events as Record<string, unknown>[] : [];
      }
      if (events.length > 50) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      return { ok: true, data: { resources: events.map((event) => normalizeDingTalkCalendarEvent(event, calendarId)),
        acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
    }
    const kind = SOURCE_KIND[input.capability];
    const resource = await this.readResource(kind, input.input, token, credential);
    return { ok: true, data: { resources: [resource],
      acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareDingTalkAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    let created: Record<string, unknown>;
    if (desired.kind === 'message') {
      created = await this.api('/v1.0/robot/oToMessages/batchSend', token, { method: 'POST', body: JSON.stringify({
        robotCode: desired.robotCode, userIds: [desired.receiveId], msgKey: 'sampleText', msgParam: JSON.stringify({ content: desired.text }) }) }, true);
      if (typeof created.msgId !== 'string' || !created.msgId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else if (desired.kind === 'calendar') {
      const path = '/v1.0/calendar/events' + (desired.eventId ? '/' + encodeURIComponent(this.id(desired.eventId)) : '');
      const body = { summary: desired.summary, start: { dateTime: new Date(desired.startAt).toISOString() }, end: { dateTime: new Date(desired.endAt).toISOString() } };
      const response = await this.api(path, token, { method: desired.eventId ? 'PATCH' : 'POST', body: JSON.stringify(body) }, true);
      created = (response.event ?? response) as Record<string, unknown>;
      if (typeof created.id !== 'string' && typeof created.eventId !== 'string') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else if (desired.kind === 'ding') {
      created = await this.api('/v1.0/im/robot/ding/send', token, { method: 'POST', body: JSON.stringify({ userIds: desired.userIds, msgParam: JSON.stringify({ content: desired.text }) }) }, true);
      if (typeof created.dingId !== 'string' || !created.dingId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } else {
      const response = await this.api('/v1.0/workflow/processInstances', token, { method: 'POST', body: JSON.stringify({
        originatorUserId: desired.originatorUserId, processCode: desired.processCode, formComponentValues: desired.formValues }) }, true);
      created = (response.instance ?? response) as Record<string, unknown>;
      if (typeof created.instanceId !== 'string' && typeof created.processInstanceId !== 'string') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    }
    try { return this.readback(desired, created, credential, token); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const desired = prepareDingTalkAction(input.input, input.capability, input.idempotencyKey);
    const token = await this.token(credential);
    const resourceId = String(input.input.resourceId ?? input.operationId ?? '');
    if (!resourceId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    return this.readback(desired, { resourceId }, credential, token);
  }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }

  private async readback(desired: ReturnType<typeof prepareDingTalkAction>, created: Record<string, unknown>, credential: Record<string, string>, token: string) {
    const capability = desired.kind === 'message' ? 'DINGTALK_MESSAGE_SEND' : desired.kind === 'calendar' ? (desired.eventId ? 'DINGTALK_CALENDAR_UPDATE' : 'DINGTALK_CALENDAR_CREATE')
      : desired.kind === 'ding' ? 'DINGTALK_DING_SEND' : 'DINGTALK_APPROVAL_PREPARE';
    let actual: Record<string, unknown>;
    if (desired.kind === 'message') {
      const messageId = String(created.msgId ?? created.resourceId ?? '');
      actual = await this.api('/v1.0/im/messages/' + encodeURIComponent(this.id(messageId)), token);
    } else if (desired.kind === 'calendar') {
      const eventId = String(created.id ?? created.eventId ?? created.resourceId ?? desired.eventId ?? '');
      actual = await this.api('/v1.0/calendar/events/' + encodeURIComponent(this.id(eventId)), token);
    } else if (desired.kind === 'ding') {
      const dingId = String(created.dingId ?? created.resourceId ?? '');
      actual = await this.api('/v1.0/im/robot/ding/' + encodeURIComponent(this.id(dingId)), token);
    } else {
      const instanceId = String(created.instanceId ?? created.processInstanceId ?? created.resourceId ?? '');
      actual = await this.api('/v1.0/workflow/processInstances/' + encodeURIComponent(this.id(instanceId)), token);
    }
    return { ok: true, data: { resourceId: String(actual.msgId ?? actual.id ?? actual.eventId ?? actual.dingId ?? actual.instanceId ?? actual.processInstanceId ?? created.resourceId ?? ''),
      verificationEvidence: dingtalkWriteEvidence(actual, desired, capability) } };
  }

  private async readResource(kind: DingTalkResourceKind, input: Record<string, unknown>, token: string, credential: Record<string, string>): Promise<Record<string, unknown>> {
    const corpId = credential.corpId;
    if (kind === 'DingTalkMessage') {
      const messageId = this.id(input.messageId);
      const raw = await this.api('/v1.0/im/messages/' + encodeURIComponent(messageId), token);
      return normalizeDingTalkResource({ messageId, corpId: raw.corpId ?? corpId, userId: raw.userId, content: raw.content, createAt: raw.createAt ?? new Date().toISOString() }, kind, corpId);
    }
    if (kind === 'DingTalkApproval') {
      const instanceId = this.id(input.instanceId);
      const raw = await this.api('/v1.0/workflow/processInstances/' + encodeURIComponent(instanceId), token);
      return normalizeDingTalkResource({ instanceId, status: raw.status, form: raw.form, updatedAt: raw.updatedAt ?? new Date().toISOString() }, kind, corpId);
    }
    const messageId = this.id(input.messageId);
    const raw = await this.api('/v1.0/workRecord/messages/' + encodeURIComponent(messageId), token);
    return normalizeDingTalkResource({ messageId, userId: raw.userId, content: raw.content, createAt: raw.createAt ?? new Date().toISOString() }, kind, corpId);
  }

  private credentials(input: ConnectorRequest) {
    const data = input.credentials?.data;
    if (!data) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    if (data.tokenMode === 'USER_OAUTH') {
      if (!data.accessToken || !data.corpId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    if (data.tokenMode === 'APP_TENANT') {
      if (!data.appKey || !data.appSecret) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      return data;
    }
    throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
  }
  private async token(credential: Record<string, string>): Promise<string> {
    if (credential.tokenMode === 'USER_OAUTH') { await this.auth.identity(credential); return credential.accessToken; }
    return (await this.auth.accessToken(credential.appKey, credential.appSecret)).token;
  }
  private assertCapability(input: ConnectorRequest, credential: Record<string, string>, write: boolean) {
    const definition = dingtalkManifest.capabilities.find((c) => c.key === input.capability);
    if (!definition || (definition.operation === 'execute') !== write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if (credential.tokenMode === 'USER_OAUTH') {
      const scopes = new Set(dingtalkScopes(credential.scopes));
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
