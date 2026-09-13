import { createHash } from 'node:crypto';
import type { GitHubOAuthConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationStartRequest, type AuthorizationCallbackRequest,
  type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { GitHubHttpClient } from './github-http.client';

const tokenEndpoint = 'https://github.com/login/oauth/access_token';
const tokenErrors = { bad_verification_code: 'AUTH_EXPIRED', bad_refresh_token: 'AUTH_REVOKED',
  access_denied: 'AUTH_REVOKED', incorrect_client_credentials: 'PERMISSION_DENIED',
  redirect_uri_mismatch: 'PERMISSION_DENIED' } as const;
export function gitHubOAuthScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  const scopes = [...new Set(value.split(/[,\s]+/).filter(Boolean))].sort();
  if (scopes.some((scope) => !/^[a-z][a-z0-9:_-]{0,95}$/.test(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  // GitHub documents offline_access as token lifecycle negotiation, not a tracked permission scope.
  return scopes.filter((scope) => scope !== 'offline_access');
}

// OAuth App mode only. PAT/App credentials never inherit classic OAuth grants.
// State ownership/one-time exchange/CAS remain in the existing Connections store.
export class GitHubOAuthClient {
  constructor(readonly config: GitHubOAuthConfig, private readonly http: GitHubHttpClient,
    readonly scopes: readonly string[] = ['repo', 'offline_access']) {}
  start(request: AuthorizationStartRequest) {
    this.assertRequest(request);
    const url = new URL('https://github.com/login/oauth/authorize');
    const fields = { client_id: this.config.clientId, redirect_uri: this.config.redirectUri, scope: this.scopes.join(' '),
      state: request.state, code_challenge: createHash('sha256').update(request.codeVerifier!).digest('base64url'),
      code_challenge_method: 'S256', allow_signup: 'false', prompt: 'select_account' };
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
  }
  async exchange(request: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> {
    this.assertRequest(request);
    if (!request.code || request.code.length > 500 || /[\x00-\x20\x7f]/.test(request.code)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return this.credential(await this.token({ code: request.code, code_verifier: request.codeVerifier!, redirect_uri: this.config.redirectUri }));
  }
  async refresh(request: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    const previous = request.credential;
    if (previous.tokenMode !== 'OAUTH_APP' || !/^[1-9][0-9]*$/.test(previous.githubUserId ?? '') || !previous.refreshToken
      || !previous.refreshExpiresAt || !Number.isFinite(Date.parse(previous.refreshExpiresAt)) || Date.parse(previous.refreshExpiresAt) <= Date.now())
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    return this.credential(await this.token({ grant_type: 'refresh_token', refresh_token: previous.refreshToken }), previous);
  }
  async revoke(credential: Record<string, string>) {
    if (credential.tokenMode !== 'OAUTH_APP' || !credential.accessToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    // Revoke this token only, never DELETE all app grants / associated SSH keys.
    await this.http.request('https://api.github.com/applications/' + encodeURIComponent(this.config.clientId) + '/token', {
      method: 'DELETE', headers: { authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64'),
        'content-type': 'application/json' }, body: JSON.stringify({ access_token: credential.accessToken }) }, true);
  }
  async identity(credential: Record<string, string>) {
    if (credential.tokenMode !== 'OAUTH_APP' || !credential.accessToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const response = await this.http.object('https://api.github.com/user', { headers: { authorization: 'Bearer ' + credential.accessToken } });
    const { id, login } = response.data;
    if (!Number.isSafeInteger(id) || (id as number) <= 0 || typeof login !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(login))
      throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    // Header is actual OAuth scope evidence, not X-Accepted-GitHub-Permissions (endpoint requirements).
    const scopes = gitHubOAuthScopes(response.headers.get('x-oauth-scopes'));
    if (scopes.join(' ') !== gitHubOAuthScopes(credential.scopes).join(' ')) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
    if (credential.githubUserId && credential.githubUserId !== String(id)) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { githubUserId: String(id), githubLogin: login, scopeObservedAt: new Date().toISOString() };
  }
  private assertRequest(request: AuthorizationStartRequest) {
    if (request.redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{32,255}$/.test(request.state)
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(request.codeVerifier ?? '')) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  private async token(fields: Record<string, string>) {
    return (await this.http.object(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...fields }).toString() }, true)).data;
  }
  private async credential(token: Record<string, unknown>, previous?: Record<string, string>): Promise<CredentialRefreshResult> {
    if (typeof token.error === 'string') throw new ProviderRuntimeError(tokenErrors[token.error as keyof typeof tokenErrors] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    if (token.token_type !== 'bearer' || typeof token.access_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.access_token))
      throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    const scopes = gitHubOAuthScopes(token.scope).join(' ');
    if (previous && scopes !== gitHubOAuthScopes(previous.scopes).join(' ')) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
    const credentials: Record<string, string> = { ...previous, tokenMode: 'OAUTH_APP', accessToken: token.access_token, scopes };
    let expiresAt: string | null = null;
    if (token.expires_in !== undefined || token.refresh_token !== undefined || token.refresh_token_expires_in !== undefined) {
      if (!Number.isSafeInteger(token.expires_in) || (token.expires_in as number) <= 0 || (token.expires_in as number) > 86400
        || !Number.isSafeInteger(token.refresh_token_expires_in) || (token.refresh_token_expires_in as number) <= 0
        || (token.refresh_token_expires_in as number) > 366 * 86400
        || typeof token.refresh_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.refresh_token)
        || (previous && (token.access_token === previous.accessToken || token.refresh_token === previous.refreshToken)))
        throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
      expiresAt = new Date(Date.now() + (token.expires_in as number) * 1000).toISOString();
      credentials.expiresAt = expiresAt; credentials.refreshToken = token.refresh_token;
      credentials.refreshExpiresAt = new Date(Date.now() + (token.refresh_token_expires_in as number) * 1000).toISOString();
    } else {
      if (previous?.refreshToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
      delete credentials.expiresAt; delete credentials.refreshToken; delete credentials.refreshExpiresAt;
    }
    Object.assign(credentials, await this.identity(credentials));
    return { credentials, expiresAt };
  }
}
