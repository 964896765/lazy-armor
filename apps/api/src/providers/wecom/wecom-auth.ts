import { createHash } from 'node:crypto';
import type { WeComAppConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationCallbackRequest, type AuthorizationStartRequest, type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { WeComHttpClient } from './wecom-http.client';
import { WECOM_SCOPES } from './wecom-manifest';

const base = 'https://qyapi.weixin.qq.com';
export const WECOM_TOKEN_MODES = ['APP_TENANT', 'USER_OAUTH'] as const;
export type WeComTokenMode = typeof WECOM_TOKEN_MODES[number];

export function wecomScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))].sort();
  if (scopes.some((scope) => !/^[a-z][a-z0-9:._-]{0,95}$/.test(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
  return scopes;
}

const tokenErrors: Record<string, ProviderRuntimeError['code']> = {
  invalid_grant: 'AUTH_REVOKED', access_denied: 'AUTH_REVOKED', invalid_code: 'AUTH_EXPIRED',
  40029: 'AUTH_EXPIRED', 40014: 'AUTH_EXPIRED', 42001: 'AUTH_EXPIRED', 40001: 'AUTH_REVOKED',
};

// WeCom corp/app + agent server-side credential and the member-delegated OAuth
// profile. appSecret never leaves the CredentialProvider; the client derives the
// corp access_token at request time and never logs or snapshots it.
export class WeComAuthClient {
  constructor(readonly config: WeComAppConfig | null, private readonly http: WeComHttpClient) {}

  start(input: AuthorizationStartRequest) {
    this.assertRequest(input);
    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    for (const [key, value] of Object.entries({ appid: this.config!.corpId, redirect_uri: this.config!.redirectUri,
      response_type: 'code', scope: 'snsapi_base', state: input.state })) url.searchParams.set(key, value);
    url.hash = 'wechat_redirect';
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
  }
  async exchange(input: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> {
    this.assertRequest(input);
    if (!input.code || input.code.length > 500 || /[\x00-\x20\x7f]/.test(input.code)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const accessToken = await this.getAccessToken(this.config!.corpId, this.config!.appSecret);
    const info = await this.http.object(base + '/cgi-bin/auth/getuserinfo?access_token=' + encodeURIComponent(accessToken.token)
      + '&code=' + encodeURIComponent(input.code));
    if (typeof info.userid !== 'string' && typeof info.UserId !== 'string') throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    return this.credential({ access_token: accessToken.token, expires_in: accessToken.expiresIn, userId: info.userid ?? info.UserId });
  }
  async refresh(input: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    const previous = input.credential;
    if (previous.tokenMode !== 'USER_OAUTH' || !previous.refreshExpiresAt
      || !Number.isFinite(Date.parse(previous.refreshExpiresAt)) || Date.parse(previous.refreshExpiresAt) <= Date.now())
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const accessToken = await this.getAccessToken(previous.corpId, this.config!.appSecret);
    return this.credential({ access_token: accessToken.token, expires_in: accessToken.expiresIn, userId: previous.userId }, previous);
  }
  async identity(credential: Record<string, string>) {
    if (credential.tokenMode !== 'USER_OAUTH' || !credential.accessToken || !credential.userId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const data = await this.http.object(base + '/cgi-bin/user/get?access_token=' + encodeURIComponent(credential.accessToken)
      + '&userid=' + encodeURIComponent(credential.userId));
    const userid = data.userid ?? data.UserId;
    if (typeof userid !== 'string' || !userid || userid !== credential.userId) throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    return { userId: userid as string, corpId: credential.corpId, scopeObservedAt: new Date().toISOString() };
  }

  async getAccessToken(corpId: string, appSecret: string): Promise<{ token: string; expiresIn: number }> {
    if (!/^[a-zA-Z0-9]{1,64}$/.test(corpId) || appSecret.length < 8 || /[\x00-\x20\x7f]/.test(appSecret))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.object(base + '/cgi-bin/gettoken?corpid=' + encodeURIComponent(corpId)
      + '&corpsecret=' + encodeURIComponent(appSecret));
    if (typeof token.access_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(token.access_token)
      || !Number.isSafeInteger(token.expires_in) || (token.expires_in as number) <= 0 || (token.expires_in as number) > 86400)
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { token: token.access_token as string, expiresIn: token.expires_in as number };
  }

  private assertRequest(input: AuthorizationStartRequest) {
    if (!this.config || input.redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{32,255}$/.test(input.state)
      || input.codeVerifier !== undefined) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  }
  private async credential(token: Record<string, unknown>, previous?: Record<string, string>): Promise<CredentialRefreshResult> {
    if (typeof token.errcode === 'number' && token.errcode !== 0) {
      const message = typeof token.errmsg === 'string' ? token.errmsg : String(token.errcode);
      throw new ProviderRuntimeError(tokenErrors[message] ?? tokenErrors[String(token.errcode)] ?? 'AUTH_EXPIRED', 'AFTER_DISPATCH');
    }
    const data = (token.data ?? token) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || !/^[A-Za-z0-9_\-.]{8,2048}$/.test(data.access_token)
      || !Number.isSafeInteger(data.expires_in) || (data.expires_in as number) <= 0 || (data.expires_in as number) > 86400
      || typeof data.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.userId)
      || (previous && previous.userId !== data.userId))
      throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    const scopes = (typeof data.scope === 'string' && data.scope ? data.scope : Object.values(WECOM_SCOPES).join(' '));
    const credential: Record<string, string> = { ...previous, tokenMode: 'USER_OAUTH', accessToken: data.access_token as string,
      refreshToken: 'wecom-corp-refresh-marker', scopes: wecomScopes(scopes).join(' '), corpId: this.config!.corpId, agentId: this.config!.agentId, userId: data.userId as string,
      appFingerprint: createHash('sha256').update(this.config!.corpId + ':' + this.config!.appSecret).digest('hex') };
    credential.expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000).toISOString();
    credential.refreshExpiresAt = new Date(Date.now() + 366 * 86400000).toISOString();
    return { credentials: credential, expiresAt: credential.expiresAt };
  }
}
