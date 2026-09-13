import { createHash } from 'node:crypto';
import type { GoogleOAuthConfig } from '@lazy-armor/config';
import { ProviderRuntimeError, type AuthorizationStartRequest, type AuthorizationCallbackRequest,
  type CredentialRefreshRequest, type CredentialRefreshResult } from '@lazy-armor/connector-sdk';
import { GoogleHttpClient } from './google-http.client';

export class GoogleOAuthClient {
  constructor(readonly config: GoogleOAuthConfig, private readonly http: GoogleHttpClient, readonly scopes: readonly string[]) {}
  start(request: AuthorizationStartRequest) {
    this.assertRedirect(request.redirectUri);
    if (!/^[A-Za-z0-9_-]{32,255}$/.test(request.state) || !request.codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(request.codeVerifier)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params = { client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code',
      scope: this.scopes.join(' '), state: request.state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
      code_challenge: createHash('sha256').update(request.codeVerifier).digest('base64url'), code_challenge_method: 'S256' };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 600_000).toISOString() };
  }
  async exchange(request: AuthorizationCallbackRequest): Promise<CredentialRefreshResult> {
    this.assertRedirect(request.redirectUri);
    if (!/^[A-Za-z0-9_-]{32,255}$/.test(request.state) || !request.code || request.code.length > 500 || !request.codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(request.codeVerifier)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const token = await this.http.form('token', { client_id: this.config.clientId, client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri, code: request.code, code_verifier: request.codeVerifier, grant_type: 'authorization_code' });
    return this.credential(token);
  }
  async refresh(request: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    if (!request.credential.refreshToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const token = await this.http.form('token', { client_id: this.config.clientId, client_secret: this.config.clientSecret,
      refresh_token: request.credential.refreshToken, grant_type: 'refresh_token' });
    return this.credential(token, request.credential);
  }
  async revoke(credential: Record<string, string>) {
    const token = credential.refreshToken ?? credential.accessToken;
    if (!token) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    await this.http.form('revoke', { token });
  }
  private assertRedirect(uri: string) { if (uri !== this.config.redirectUri) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
  private credential(token: Record<string, unknown>, previous?: Record<string, string>): CredentialRefreshResult {
    if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' || !token.access_token
      || !Number.isSafeInteger(token.expires_in) || (token.expires_in as number) <= 0 || (token.expires_in as number) > 86400)
      throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    const scopes = typeof token.scope === 'string' ? token.scope : previous?.scopes;
    if (!scopes) throw new ProviderRuntimeError('SCOPE_MISSING', 'AFTER_DISPATCH');
    const expiresAt = new Date(Date.now() + (token.expires_in as number) * 1000).toISOString();
    const credentials: Record<string, string> = { ...previous, accessToken: token.access_token, scopes, expiresAt };
    if (typeof token.refresh_token === 'string' && token.refresh_token) credentials.refreshToken = token.refresh_token;
    // Offline execution cannot pretend refresh is possible without a refresh token.
    if (!credentials.refreshToken) throw new ProviderRuntimeError('AUTH_REVOKED', 'AFTER_DISPATCH');
    return { credentials, expiresAt };
  }
}
