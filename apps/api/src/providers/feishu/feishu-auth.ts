import { createHash } from 'node:crypto';
import type { FeishuAppConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationCallbackRequest, type AuthorizationStartRequest, type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { FeishuHttpClient } from './feishu-http.client';
import { FEISHU_SCOPES } from './feishu-manifest';

const base = 'https://open.feishu.cn/open-apis';
export const FEISHU_TOKEN_MODES = ['APP_TENANT', 'USER_OAUTH'] as const;
export type FeishuTokenMode = typeof FEISHU_TOKEN_MODES[number];

export function feishuScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))].sort();
  if (scopes.some((scope) => !/^[a-z][a-z0-9:._-]{0,95}$/.test(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  return scopes;
}

const tokenErrors: Record<string, ProviderRuntimeError['code']> = {
  invalid_grant: 'AUTH_REVOKED', access_denied: 'AUTH_REVOKED', invalid_code: 'AUTH_EXPIRED',
  invalid_client: 'PERMISSION_DENIED', redirect_uri_mismatch: 'PERMISSION_DENIED', scope_not_authorized: 'SCOPE_MISSING',
};

// Feishu app / tenant and user-delegated OAuth credential profiles. Real
// app_id/app_secret only ever enter the existing CredentialProvider; this client
// never logs or snapshots them and derives access tokens at request time.
export class FeishuAuthClient {
  constructor(readonly config: FeishuAppConfig | null, private readonly http: FeishuHttpClient) {}

  // --- user delegated OAuth (authorization code -> token exchange -> refresh) ---
  start(input: AuthorizationStartRequest) {
    this.assertRequest(input);
    const url = new URL(base + '/authen/v1/authorize');
    for (const [key, value] of Object.entries({ app_id: this.config!.appId, redirect_uri: this.config!.redirectUri,
      response_type: 'code', scope: Object.values(FEISHU_SCOPES).join(' '), state: input.state })) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
  }
  async exchange(input: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> {
    this.assertRequest(input);
    if (!input.code || input.code.length > 500 || /[\x00-\x20\x7f]/.test(input.code)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const appToken = await this.appAccessToken();
    const token = await this.http.object(base + '/authen/v2/oauth/token', { method: 'POST',
      headers: { authorization: 'Bearer ' + appToken },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: this.config!.appId, client_secret: this.config!.appSecret, code: input.code, redirect_uri: this.config!.redirectUri }) }, true);
    return this.credential(token);
  }
  async refresh(input: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    const previous = input.credential;
    if (previous.tokenMode !== 'USER_OAUTH' || !previous.refreshToken || !previous.refreshExpiresAt
      || !Number.isFinite(Date.parse(previous.refreshExpiresAt)) || Date.parse(previous.refreshExpiresAt) <= Date.now())
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const appToken = await this.appAccessToken();
    const token = await this.http.object(base + '/authen/v2/oauth/token', { method: 'POST',
      headers: { authorization: 'Bearer ' + appToken },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: this.config!.appId, client_secret: this.config!.appSecret, refresh_token: previous.refreshToken }) }, true);
    return this.credential(token, previous);
  }
  async identity(credential: Record<string, string>) {
    if (credential.tokenMode !== 'USER_OAUTH' || !credential.accessToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const data = await this.http.object(base + '/authen/v1/user_info', { headers: { authorization: 'Bearer ' + credential.accessToken } });
    if (!data || typeof data.open_id !== 'string' || !data.open_id || typeof data.tenant_key !== 'string' || !data.tenant_key)
      throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    if (credential.openId && credential.openId !== data.open_id) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    if (credential.tenantKey && credential.tenantKey !== data.tenant_key) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { openId: data.open_id as string, tenantKey: data.tenant_key as string, scopeObservedAt: new Date().toISOString() };
  }

  // --- app / tenant credential (app_id/app_secret -> tenant_access_token) ---
  async tenantAccessToken(appId: string, appSecret: string): Promise<{ token: string; expiresAt: string }> {
    if (!/^cli_[a-zA-Z0-9]{8,64}$/.test(appId) || appSecret.length < 8 || /[\x00-\x20\x7f]/.test(appSecret))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/auth/v3/tenant_access_token/internal', { method: 'POST',
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }) }, true);
    if (typeof token.tenant_access_token !== 'string' || !token.tenant_access_token || !Number.isSafeInteger(token.expire) || (token.expire as number) <= 0)
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { token: token.tenant_access_token as string, expiresAt: new Date(Date.now() + (token.expire as number) * 1000).toISOString() };
  }
  async appAccessToken(): Promise<string> {
    if (!this.config) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/auth/v3/app_access_token/internal', { method: 'POST',
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }) }, true);
    if (typeof token.app_access_token !== 'string' || !token.app_access_token) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return token.app_access_token as string;
  }

  private assertRequest(input: AuthorizationStartRequest) {
    if (!this.config || input.redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{32,255}$/.test(input.state)
      || input.codeVerifier !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  private async credential(token: Record<string, unknown>, previous?: Record<string, string>): Promise<CredentialRefreshResult> {
    if (typeof token.code === 'number' && token.code !== 0) {
      const message = typeof token.msg === 'string' ? token.msg : '';
      throw new ProviderRuntimeError(tokenErrors[message] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    }
    if (typeof token.error === 'string') throw new ProviderRuntimeError(tokenErrors[token.error] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    const data = (token.data ?? token) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(data.access_token)
      || typeof data.refresh_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(data.refresh_token)
      || !Number.isSafeInteger(data.expires_in) || (data.expires_in as number) <= 0 || (data.expires_in as number) > 86400
      || !Number.isSafeInteger(data.refresh_token_expires_in) || (data.refresh_token_expires_in as number) <= 0
      || (data.refresh_token_expires_in as number) > 366 * 86400
      || typeof data.open_id !== 'string' || !data.open_id || typeof data.tenant_key !== 'string' || !data.tenant_key
      || (previous && (previous.accessToken === data.access_token || previous.refreshToken === data.refresh_token
        || previous.openId !== data.open_id || previous.tenantKey !== data.tenant_key)))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    const scopes = feishuScopes(data.scope).join(' ');
    const credential: Record<string, string> = { ...previous, tokenMode: 'USER_OAUTH', accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string, scopes, openId: data.open_id as string, tenantKey: data.tenant_key as string,
      appId: this.config!.appId, appFingerprint: createHash('sha256').update(this.config!.appId + ':' + this.config!.appSecret).digest('hex') };
    credential.expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000).toISOString();
    credential.refreshExpiresAt = new Date(Date.now() + (data.refresh_token_expires_in as number) * 1000).toISOString();
    return { credentials: credential, expiresAt: credential.expiresAt };
  }
}
