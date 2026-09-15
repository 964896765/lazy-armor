import { evaluateVerification } from '@lazy-armor/plan-schema';
import { ProviderRuntimeError, type ConnectorMetadata, type ConnectorRequest, type CredentialRefreshRequest, type ProviderAdapter, type ProviderAuthorizationRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { NotionHttpClient } from './notion-http.client'; import { NotionOAuthClient, notionScopes } from './notion-oauth.client';
import { notionManifest, NOTION_CAPABILITIES, NOTION_SCOPES } from './notion-manifest';
import { notionId, normalizeNotionResource, notionPropertyPayload, notionWriteEvidence, prepareNotionAction } from './notion-resource';
const base = 'https://api.notion.com/v1';
export class NotionProviderAdapter implements ProviderAdapter {
  constructor(private readonly oauth: NotionOAuthClient, private readonly http: NotionHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'notion', name: 'Notion', description: 'Public OAuth Page/Data Source adapter; real workspace acceptance is separate.', version: '0.1.0', connectorSdkVersion: '0.1.0', providerType: 'content', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'READ_PAGE', supportsRefresh: true, supportsRevoke: true, supportsPKCE: false, requiresRedirect: true } }, supportsRefresh: true, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(notionManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) { if (input.phase === 'START') return { phase: 'START' as const, result: this.oauth.start(input.request) };
    const token = await this.oauth.exchange(input.request); const scopes = notionScopes(token.credentials.scopes); const resources = await this.search(token.credentials);
    token.credentials.resources = JSON.stringify(resources); const grantedCapabilities = NOTION_CAPABILITIES.filter((key) => {
      const required = notionManifest.capabilities.find((v) => v.key === key)!.oauthScopes; return required.every((scope) => scopes.includes(scope)) && resources.length > 0; });
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: token.credentials.workspaceId, grantedCapabilities } }; }
  refresh(input: CredentialRefreshRequest) { return this.oauth.refresh(input); }
  revoke(input: ConnectorRequest) { return this.oauth.revoke(this.credentials(input)); }
  async health(input?: ConnectorRequest) { if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); await this.oauth.identity(this.credentials(input));
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() }; }
  async read(input: ConnectorRequest) { const credential = this.credentials(input); this.assertCapability(input, credential, false); const id = notionId.safeParse(input.input.resourceId);
    if (!id.success) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); await this.oauth.identity(credential);
    const path = input.capability === 'READ_PAGE' ? '/pages/' : '/data_sources/'; const root = normalizeNotionResource(await this.api(path + id.data, credential), credential.workspaceId, id.data);
    const resources = [root];
    if (input.capability === 'READ_DATA_SOURCE' && input.input.includeRows === true) { const maxItems = Number(input.input.maxItems ?? 20);
      if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      const result = await this.api('/data_sources/' + id.data + '/query', credential, { method: 'POST', body: JSON.stringify({ page_size: maxItems }) });
      if (!Array.isArray(result.results) || result.results.length > maxItems) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      for (const raw of result.results) resources.push(normalizeNotionResource(raw as Record<string, unknown>, credential.workspaceId)); }
    return { ok: true, data: { resources, acquisition: { capabilityKey: input.capability, credentialVersion: input.credentials?.version ?? 0, requestId: input.requestId, acquiredAt: new Date().toISOString() } } };
  }
  async execute(input: ConnectorRequest) { const credential = this.credentials(input); this.assertCapability(input, credential, true); const update = input.capability === 'UPDATE_PAGE'; const desired = prepareNotionAction(input.input, input.idempotencyKey, update);
    await this.oauth.identity(credential); await this.preflight(desired, credential, update); const body = { ...(update ? {} : { parent: { type: desired.parent.type, [desired.parent.type]: desired.parent.id } }), properties: notionPropertyPayload(desired.properties) };
    const raw = await this.api(update ? '/pages/' + desired.pageId : '/pages', credential, { method: update ? 'PATCH' : 'POST', body: JSON.stringify(body) }, true);
    if (!notionId.safeParse(raw.id).success) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    try { const readback = await this.api('/pages/' + raw.id, credential); return this.evidence(readback, { ...desired, pageId: String(raw.id) }, credential); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) { const credential = this.credentials(input); this.assertCapability(input, credential, true); const update = input.capability === 'UPDATE_PAGE'; const desired = prepareNotionAction(input.input, input.idempotencyKey, update);
    await this.oauth.identity(credential); if (!desired.pageId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    const raw = await this.api('/pages/' + desired.pageId, credential); const result = this.evidence(raw, desired, credential); if (!result.data.verificationEvidence || !(result.data.verificationEvidence as Record<string, unknown>).matched) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); return result; }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }
  private evidence(raw: Record<string, unknown>, desired: ReturnType<typeof prepareNotionAction>, credential: Record<string, string>) { return { ok: true, data: { resourceId: String(raw.id), workspaceId: credential.workspaceId, verificationEvidence: notionWriteEvidence(raw, desired, credential.workspaceId) } }; }
  private async preflight(desired: ReturnType<typeof prepareNotionAction>, credential: Record<string, string>, update: boolean) { const parent = await this.api('/' + (desired.parent.type === 'page_id' ? 'pages/' : 'data_sources/') + desired.parent.id, credential);
    if (desired.parent.type === 'data_source_id') { const schema = parent.properties as Record<string, { type?: string }> | undefined;
      if (!schema || Object.entries(desired.properties).some(([name, prop]) => schema[name]?.type !== prop.type)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    if (update) { const page = await this.api('/pages/' + desired.pageId, credential); const normalized = normalizeNotionResource(page, credential.workspaceId, desired.pageId);
      if (JSON.stringify(normalized.parent) !== JSON.stringify({ type: desired.parent.type, [desired.parent.type]: desired.parent.id })
        || (desired.expectedLastEditedTime && normalized.updatedAt !== desired.expectedLastEditedTime)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); } }
  private async search(credential: Record<string, string>) { const raw = await this.api('/search', credential, { method: 'POST', body: JSON.stringify({ page_size: 100 }) });
    if (!Array.isArray(raw.results) || raw.results.length > 100) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH'); return raw.results.map((item) => {
      const value = item as Record<string, unknown>; const id = notionId.safeParse(value.id); if (!id.success || !['page', 'data_source'].includes(String(value.object))) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH'); return { id: id.data, type: value.object }; }); }
  private credentials(input: ConnectorRequest) { const data = input.credentials?.data; if (!data) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); return data; }
  private assertCapability(input: ConnectorRequest, credential: Record<string, string>, write: boolean) { const definition = notionManifest.capabilities.find((v) => v.key === input.capability);
    if (!definition || (definition.operation === 'execute') !== write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); const actual = notionScopes(credential.scopes);
    if (!definition.oauthScopes.every((scope) => actual.includes(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH'); }
  private async api(path: string, credential: Record<string, string>, init: RequestInit = {}, write = false) { return this.http.object(base + path, { ...init, headers: { authorization: 'Bearer ' + credential.accessToken, ...init.headers } }, write); }
}
