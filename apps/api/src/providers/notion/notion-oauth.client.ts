import type { NotionOAuthConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationStartRequest, type AuthorizationCallbackRequest, type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { NotionHttpClient } from './notion-http.client';

const base = 'https://api.notion.com/v1'; const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function notionScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))].sort();
  if (scopes.some((scope) => !/^[a-z][a-z0-9:_-]{0,95}$/.test(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  return scopes;
}
export class NotionOAuthClient {
  constructor(readonly config: NotionOAuthConfig, private readonly http: NotionHttpClient) {}
  start(input: AuthorizationStartRequest) { this.assertRequest(input); const url = new URL(base + '/oauth/authorize');
    for (const [key, value] of Object.entries({ owner: 'user', client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', state: input.state })) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600000).toISOString() }; }
  async exchange(input: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> { this.assertRequest(input);
    if (!input.code || input.code.length > 500 || /[\x00-\x20\x7f]/.test(input.code)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return this.credential(await this.basic('/oauth/token', { grant_type: 'authorization_code', code: input.code, redirect_uri: this.config.redirectUri })); }
  async refresh(input: CredentialRefreshRequest): Promise<CredentialRefreshResult> { this.assertCredential(input.credential);
    if (!input.credential.refreshToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    return this.credential(await this.basic('/oauth/token', { grant_type: 'refresh_token', refresh_token: input.credential.refreshToken }), input.credential); }
  async revoke(credential: Record<string, string>) { this.assertCredential(credential); await this.basic('/oauth/revoke', { token: credential.accessToken }); }
  async identity(credential: Record<string, string>) { this.assertCredential(credential); const introspection = await this.basic('/oauth/introspect', { token: credential.accessToken });
    if (introspection.active !== true) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH'); const scopes = notionScopes(introspection.scope);
    if (credential.scopes !== undefined && scopes.join(' ') !== notionScopes(credential.scopes).join(' ')) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
    const bot = await this.http.object(base + '/users/me', { headers: { authorization: 'Bearer ' + credential.accessToken } });
    if (bot.object !== 'user' || bot.type !== 'bot' || bot.id !== credential.botId) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { scopes: scopes.join(' '), scopeObservedAt: new Date().toISOString() }; }
  private assertRequest(input: AuthorizationStartRequest) { if (input.redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{32,255}$/.test(input.state) || input.codeVerifier !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
  private assertCredential(credential: Record<string, string>) { if (credential.tokenMode !== 'PUBLIC_OAUTH' || !credential.accessToken || !uuid.test(credential.botId ?? '') || !uuid.test(credential.workspaceId ?? '') || !uuid.test(credential.ownerId ?? '')) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); }
  private basic(path: string, body: Record<string, unknown>) { return this.http.object(base + path, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64') }, body: JSON.stringify(body) }); }
  private async credential(token: Record<string, unknown>, previous?: Record<string, string>): Promise<CredentialRefreshResult> {
    if (token.error) throw new ProviderRuntimeError(token.error === 'invalid_grant' ? 'AUTH_REVOKED' : 'AUTH_EXPIRED', 'AFTER_DISPATCH'); const owner = token.owner as { type?: string; user?: { id?: string } } | undefined;
    if (typeof token.access_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.access_token) || typeof token.refresh_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.refresh_token)
      || typeof token.bot_id !== 'string' || !uuid.test(token.bot_id) || typeof token.workspace_id !== 'string' || !uuid.test(token.workspace_id)
      || owner?.type !== 'user' || typeof owner.user?.id !== 'string' || !uuid.test(owner.user.id)
      || (previous && (previous.botId !== token.bot_id || previous.workspaceId !== token.workspace_id || previous.ownerId !== owner.user.id || previous.accessToken === token.access_token || previous.refreshToken === token.refresh_token))) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    const credential: Record<string, string> = { ...previous, tokenMode: 'PUBLIC_OAUTH', accessToken: token.access_token, refreshToken: token.refresh_token, botId: token.bot_id, workspaceId: token.workspace_id, ownerId: owner.user.id };
    delete credential.expiresAt; Object.assign(credential, await this.identity(credential)); return { credentials: credential, expiresAt: null };
  }
}
