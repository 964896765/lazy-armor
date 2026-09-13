import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { GoogleHttpClient } from '../google/google-http.client';
import { GoogleOAuthClient } from '../google/google-oauth.client';
import { gmailManifest } from './gmail-manifest';
import { normalizeMessage, operationMessageId, prepareMail, readbackEvidence } from './gmail-message';

const base = 'https://gmail.googleapis.com/gmail/v1/users/me/';
export class GmailProviderAdapter implements ProviderAdapter {
  constructor(private readonly oauth: GoogleOAuthClient, private readonly http: GoogleHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'gmail', name: 'Gmail', description: 'Google OAuth and Gmail REST; real-account acceptance is separate.',
    version: '0.2.0', connectorSdkVersion: '0.1.0', providerType: 'email', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'READ_EMAIL_METADATA', supportsRefresh: true, supportsRevoke: true, supportsPKCE: true, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(gmailManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.oauth.start(input.request) };
    const token = await this.oauth.exchange(input.request);
    const profile = await this.api('profile', token.credentials);
    if (typeof profile.emailAddress !== 'string' || !profile.emailAddress.includes('@')) throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    token.credentials.emailAddress = profile.emailAddress;
    const granted = new Set(token.credentials.scopes.split(/\s+/));
    return { phase: 'CALLBACK' as const, result: { externalAccountName: profile.emailAddress, ...token,
      grantedCapabilities: gmailManifest.capabilities.filter((c) => c.oauthScopes.every((s) => granted.has(s))).map((c) => c.key) } };
  }
  refresh(input: CredentialRefreshRequest) { return this.oauth.refresh(input); }
  async revoke(input: ConnectorRequest) { await this.oauth.revoke(this.credentials(input)); }
  async health(input?: ConnectorRequest) {
    if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    await this.api('profile', this.credentials(input));
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() };
  }
  async read(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (input.capability === 'READ_EMAIL_LABELS' && !input.input.messageId) {
      const labels = await this.api('labels', credential); return { ok: true, data: { labels: labels.labels ?? [] } };
    }
    const full = input.capability === 'READ_EMAIL_BODY';
    if (!['READ_EMAIL_METADATA', 'READ_EMAIL_BODY', 'READ_EMAIL_LABELS'].includes(input.capability)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const ids: string[] = []; let nextPageToken: unknown;
    if (input.input.messageId) ids.push(this.id(input.input.messageId));
    else {
      const max = input.input.maxItems ?? 20;
      if (!Number.isSafeInteger(max) || (max as number) < 1 || (max as number) > 50) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      const query = new URLSearchParams({ maxResults: String(max) });
      for (const field of ['q', 'pageToken']) if (input.input[field] !== undefined) {
        if (typeof input.input[field] !== 'string' || (input.input[field] as string).length > 500) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
        query.set(field, input.input[field] as string);
      }
      const list = await this.api('messages?' + query.toString(), credential);
      if (Array.isArray(list.messages)) for (const m of list.messages.slice(0, max as number)) ids.push(this.id((m as Record<string, unknown>).id, true));
      nextPageToken = list.nextPageToken;
    }
    const messages = [];
    for (const id of ids) messages.push(normalizeMessage(await this.api(`messages/${id}?format=${full ? 'full' : 'metadata'}`, credential), full));
    return { ok: true, data: { messages, ...(typeof nextPageToken === 'string' ? { nextPageToken } : {}) } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (!['SEND_EMAIL', 'CREATE_EMAIL_DRAFT'].includes(input.capability)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const desired = prepareMail(input.input, credential.emailAddress, input.idempotencyKey);
    const draft = input.capability === 'CREATE_EMAIL_DRAFT';
    // Exactly one mutation. A lost response or failed read-back is never retried here.
    const created = await this.api(draft ? 'drafts' : 'messages/send', credential, {
      method: 'POST', body: JSON.stringify(draft ? { message: { raw: desired.raw } } : { raw: desired.raw }),
    }, true);
    const id = this.id(created.id, true);
    const readback = await this.api(`${draft ? 'drafts' : 'messages'}/${id}?format=full`, credential);
    const actual = normalizeMessage(draft ? readback.message as Record<string, unknown> : readback, true);
    return { ok: true, data: { messageId: actual.messageId, ...(draft ? { draftId: id } : {}),
      verificationEvidence: readbackEvidence(actual, desired, draft ? 'DRAFT' : 'SENT') } };
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (!['SEND_EMAIL', 'CREATE_EMAIL_DRAFT'].includes(input.capability)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const desired = prepareMail(input.input, credential.emailAddress, input.idempotencyKey);
    const label = input.capability === 'SEND_EMAIL' ? 'SENT' : 'DRAFT';
    const query = new URLSearchParams({ q: `rfc822msgid:${operationMessageId(input.idempotencyKey)}`, labelIds: label, maxResults: '2' });
    const list = await this.api('messages?' + query.toString(), credential);
    if (!Array.isArray(list.messages) || list.messages.length !== 1) return { ok: true, data: { verificationEvidence: { matched: false, reason: 'NOT_UNIQUELY_VISIBLE' } } };
    const id = this.id((list.messages[0] as Record<string, unknown>).id, true);
    const actual = normalizeMessage(await this.api(`messages/${id}?format=full`, credential), true);
    return { ok: true, data: { messageId: id, verificationEvidence: readbackEvidence(actual, desired, label) } };
  }
  async verify(input: VerificationRequest) {
    const result = evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data);
    return { state: result, method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data };
  }
  private id(value: unknown, afterDispatch = false) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new ProviderRuntimeError(
      afterDispatch ? 'PROVIDER_UNAVAILABLE' : 'PERMISSION_DENIED', afterDispatch ? 'AFTER_DISPATCH' : 'BEFORE_DISPATCH');
    return value;
  }
  private credentials(input: ConnectorRequest) {
    const data = input.credentials?.data;
    if (!data?.accessToken || !data.scopes) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    return data;
  }
  private assertScopes(input: ConnectorRequest, credential: Record<string, string>) {
    const capability = gmailManifest.capabilities.find((c) => c.key === input.capability);
    const granted = new Set(credential.scopes.split(/\s+/));
    if (!capability || !capability.oauthScopes.every((s) => granted.has(s))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
  }
  private api(path: string, credential: Record<string, string>, init: RequestInit = {}, write = false) {
    return this.http.request(base + path, { ...init, headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': 'application/json' } }, write);
  }
}
