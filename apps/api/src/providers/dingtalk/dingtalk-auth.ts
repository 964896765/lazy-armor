import { createHash } from 'node:crypto';
import type { DingTalkAppConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationCallbackRequest, type AuthorizationStartRequest, type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { DingTalkHttpClient } from './dingtalk-http.client';
import { DINGTALK_SCOPES } from './dingtalk-manifest';

const base = 'https://api.dingtalk.com';
export const DINGTALK_TOKEN_MODES = ['APP_TENANT', 'USER_OAUTH'] as const;
export type DingTalkTokenMode = typeof DINGTALK_TOKEN_MODES[number];

export function dingtalkScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))].sort();
  if (scopes.some((scope) => !/^[a-z][a-z0-9:._-]{0,95}$/.test(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  return scopes;
}

const tokenErrors: Record<string, ProviderRuntimeError['code']> = {
  invalid_grant: 'AUTH_REVOKED', access_denied: 'AUTH_REVOKED', invalid_code: 'AUTH_EXPIRED',
  invalid_client: 'PERMISSION_DENIED', redirect_uri_mismatch: 'PERMISSION_DENIED',
  invalidParameter: 'PERMISSION_DENIED', InvalidAuthentication: 'AUTH_EXPIRED', InvalidAccessToken: 'AUTH_EXPIRED',
};

// DingTalk enterprise app credential (appKey/appSecret -> accessToken) and the
// short-lived user authCode exchange. authCode is consumed once server-side and
// never persisted, logged or treated as a Connection credential.
export class DingTalkAuthClient {
  constructor(readonly config: DingTalkAppConfig | null, private readonly http: DingTalkHttpClient) {}

  start(input: AuthorizationStartRequest) {
    this.assertRequest(input);
    const url = new URL('https://login.dingtalk.com/oauth2/auth');
    for (const [key, value] of Object.entries({ redirect_uri: this.config!.redirectUri, response_type: 'code',
      client_id: this.config!.appKey, scope: 'openid', state: input.state, prompt: 'consent' })) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
  }
  async exchange(input: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> {
    this.assertRequest(input);
    if (!input.code || input.code.length > 500 || /[\x00-\x20\x7f]/.test(input.code)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/v1.0/oauth2/userAccessToken', { method: 'POST',
      body: JSON.stringify({ clientId: this.config!.appKey, clientSecret: this.config!.appSecret, code: input.code, grantType: 'authorization_code' }) }, true);
    return this.credential(token);
  }
  async refresh(input: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    const previous = input.credential;
    if (previous.tokenMode !== 'USER_OAUTH' || !previous.refreshToken || !previous.refreshExpiresAt
      || !Number.isFinite(Date.parse(previous.refreshExpiresAt)) || Date.parse(previous.refreshExpiresAt) <= Date.now())
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/v1.0/oauth2/userAccessToken', { method: 'POST',
      body: JSON.stringify({ clientId: this.config!.appKey, clientSecret: this.config!.appSecret, refreshToken: previous.refreshToken, grantType: 'refresh_token' }) }, true);
    return this.credential(token, previous);
  }
  async identity(credential: Record<string, string>) {
    if (credential.tokenMode !== 'USER_OAUTH' || !credential.accessToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const data = await this.http.object(base + '/v1.0/contact/users/me', { headers: { authorization: 'Bearer ' + credential.accessToken } });
    if (typeof data.openId !== 'string' || !data.openId || typeof data.corpId !== 'string' || !data.corpId)
      throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    if (credential.openId && credential.openId !== data.openId) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    if (credential.corpId && credential.corpId !== data.corpId) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { openId: data.openId as string, corpId: data.corpId as string, scopeObservedAt: new Date().toISOString() };
  }

  async accessToken(appKey: string, appSecret: string): Promise<{ token: string; expiresAt: string }> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(appKey) || appSecret.length < 8 || /[\x00-\x20\x7f]/.test(appSecret))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/v1.0/oauth2/accessToken', { method: 'POST',
      body: JSON.stringify({ appKey, appSecret }) }, true);
    if (typeof token.accessToken !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.accessToken)
      || !Number.isSafeInteger(token.expireIn) || (token.expireIn as number) <= 0 || (token.expireIn as number) > 86400)
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { token: token.accessToken as string, expiresAt: new Date(Date.now() + (token.expireIn as number) * 1000).toISOString() };
  }

  private assertRequest(input: AuthorizationStartRequest) {
    if (!this.config || input.redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{32,255}$/.test(input.state)
      || input.codeVerifier !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  private async credential(token: Record<string, unknown>, previous?: Record<string, string>): Promise<CredentialRefreshResult> {
    if (typeof token.errcode === 'number' && token.errcode !== 0) {
      const message = typeof token.errmsg === 'string' ? token.errmsg : '';
      throw new ProviderRuntimeError(tokenErrors[message] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    }
    if (typeof token.code === 'string') throw new ProviderRuntimeError(tokenErrors[token.code] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    if (typeof token.error === 'string') throw new ProviderRuntimeError(tokenErrors[token.error] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    const data = (token.data ?? token) as Record<string, unknown>;
    if (typeof data.accessToken !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(data.accessToken)
      || typeof data.refreshToken !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(data.refreshToken)
      || !Number.isSafeInteger(data.expireIn) || (data.expireIn as number) <= 0 || (data.expireIn as number) > 86400
      || typeof data.corpId !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(data.corpId)
      || (previous && (previous.accessToken === data.accessToken || previous.refreshToken === data.refreshToken || previous.corpId !== data.corpId)))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    const openId = typeof data.openId === 'string' ? data.openId : '';
    const scopes = (typeof data.scope === 'string' && data.scope ? data.scope : Object.values(DINGTALK_SCOPES).join(' '));
    const credential: Record<string, string> = { ...previous, tokenMode: 'USER_OAUTH', accessToken: data.accessToken as string,
      refreshToken: data.refreshToken as string, scopes: dingtalkScopes(scopes).join(' '), corpId: data.corpId as string,
      openId, appKey: this.config!.appKey, appFingerprint: createHash('sha256').update(this.config!.appKey + ':' + this.config!.appSecret).digest('hex') };
    credential.expiresAt = new Date(Date.now() + (data.expireIn as number) * 1000).toISOString();
    credential.refreshExpiresAt = new Date(Date.now() + 366 * 86400000).toISOString();
    return { credentials: credential, expiresAt: credential.expiresAt };
  }
}
