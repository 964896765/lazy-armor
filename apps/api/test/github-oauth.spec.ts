import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GitHubHttpClient, type GitHubTransport } from '../src/providers/github/github-http.client';
import { GitHubOAuthClient } from '../src/providers/github/github-oauth.client';
const config = { clientId: 'isolated-client', clientSecret: 'isolated-client-secret', redirectUri: 'https://isolated.example/api/providers/github/oauth/callback' };
const request = { userId: 'isolated-user', state: 'a'.repeat(48), codeVerifier: 'v'.repeat(64), redirectUri: config.redirectUri };
const expiring = { access_token: 'isolated-access', token_type: 'bearer', scope: 'repo', expires_in: 28800,
  refresh_token: 'isolated-refresh', refresh_token_expires_in: 15897600 };
const response = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { headers });
function setup(token: Record<string, unknown> = expiring, identity: Record<string, unknown> = { id: 42, login: 'isolated-user' }, scopes: string | null = 'repo') {
  const transport = vi.fn<GitHubTransport>(async (url) => url.startsWith('https://github.com/') ? response(token)
    : response(identity, scopes === null ? {} : { 'x-oauth-scopes': scopes }));
  return { transport, oauth: new GitHubOAuthClient(config, new GitHubHttpClient(transport)) };
}

describe('GitHub OAuth App contract; no real account acceptance and no second state store', () => {
  it('uses exact callback, state, S256 and offline_access without exposing client secret', () => {
    const { oauth, transport } = setup(); const result = oauth.start(request); const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe('https://github.com'); expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(request.codeVerifier).digest('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri); expect(url.searchParams.get('scope')).toBe('repo offline_access');
    expect(result.authorizationUrl).not.toContain(config.clientSecret); expect(transport).not.toHaveBeenCalled();
  });
  it.each([{ state: 'guessable' }, { codeVerifier: undefined }, { codeVerifier: 'x'.repeat(129) }, { redirectUri: config.redirectUri + '/wildcard' }])('rejects unsafe start/exchange request %j without external I/O', async (bad) => {
    const { oauth, transport } = setup(); expect(() => oauth.start({ ...request, ...bad })).toThrow();
    await expect(oauth.exchange({ ...request, ...bad, code: 'isolated-code' })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' }); expect(transport).not.toHaveBeenCalled();
  });
  it('exchanges once then validates actual identity and scope header, retaining actual expiry', async () => {
    const { oauth, transport } = setup(); const result = await oauth.exchange({ ...request, code: 'isolated-code' });
    const form = new URLSearchParams(transport.mock.calls[0][1].body as string);
    expect(form.get('code_verifier')).toBe(request.codeVerifier); expect(form.get('redirect_uri')).toBe(config.redirectUri);
    expect(form.get('client_secret')).toBe(config.clientSecret); expect(transport).toHaveBeenCalledTimes(2);
    expect(result.credentials).toMatchObject({ githubUserId: '42', tokenMode: 'OAUTH_APP', githubLogin: 'isolated-user', scopes: 'repo', refreshToken: expiring.refresh_token });
    expect(Date.parse(result.expiresAt!)).toBeGreaterThan(Date.now());
  });
  it('does not fabricate expiry/refresh token for a documented non-expiring OAuth token', async () => {
    const { oauth } = setup({ access_token: 'isolated-access', token_type: 'bearer', scope: 'repo' });
    const result = await oauth.exchange({ ...request, code: 'isolated-code' }); expect(result.expiresAt).toBeNull();
    expect(result.credentials).not.toHaveProperty('refreshToken'); await expect(oauth.refresh({ credential: result.credentials })).rejects.toMatchObject({ code: 'AUTH_REVOKED', phase: 'BEFORE_DISPATCH' });
  });
  it.each([{ token_type: 'Bearer' }, { scope: undefined }, { expires_in: 0 }, { refresh_token: undefined }, { refresh_token_expires_in: undefined }])('rejects malformed token contract %j before identity I/O', async (bad) => {
    const { oauth, transport } = setup({ ...expiring, ...bad }); await expect(oauth.exchange({ ...request, code: 'isolated-code' })).rejects.toBeDefined(); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'public_repo', null])('does not substitute endpoint requirements or login success for actual repo scope %j', async (scopes) => {
    const { oauth } = setup(expiring, undefined, scopes); await expect(oauth.exchange({ ...request, code: 'isolated-code' })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
  });
  it('does not parse PAT/App token without OAuth scope header as OAuth App grant evidence', async () => {
    const transport: GitHubTransport = async (url) => url.startsWith('https://github.com/') ? response(expiring)
      : response({ id: 42, login: 'isolated-user' }, { 'x-accepted-github-permissions': 'issues=write' });
    await expect(new GitHubOAuthClient(config, new GitHubHttpClient(transport)).exchange({ ...request, code: 'isolated-code' })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
  });
  it('maps HTTP-200 OAuth errors without emitting provider error text or secrets', async () => {
    const { oauth, transport } = setup({ error: 'bad_refresh_token', error_description: config.clientSecret });
    const error = await oauth.exchange({ ...request, code: 'isolated-code' }).catch((e) => e);
    expect(error.code).toBe('AUTH_REVOKED'); expect(String(error)).not.toContain(config.clientSecret); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rotates actual token pair once, binds immutable numeric identity, and does not widen scopes', async () => {
    const initial = await setup().oauth.exchange({ ...request, code: 'isolated-code' });
    const { oauth, transport } = setup({ ...expiring, access_token: 'isolated-access-new', refresh_token: 'isolated-refresh-new' }, { id: 42, login: 'renamed-user' });
    const result = await oauth.refresh({ credential: initial.credentials }); const form = new URLSearchParams(transport.mock.calls[0][1].body as string);
    expect(form.get('grant_type')).toBe('refresh_token'); expect(form.has('scope')).toBe(false); expect(transport).toHaveBeenCalledTimes(2);
    expect(result.credentials).toMatchObject({ githubUserId: '42', githubLogin: 'renamed-user', refreshToken: 'isolated-refresh-new' });
    await expect(setup({ ...expiring, access_token: 'isolated-access-new', refresh_token: 'isolated-refresh-new' }, { id: 99, login: 'other-user' }).oauth.refresh({ credential: initial.credentials })).rejects.toMatchObject({ code: 'AUTH_REVOKED' });
    await expect(setup({ ...expiring, scope: 'repo,gist', access_token: 'isolated-access-new', refresh_token: 'isolated-refresh-new' }, undefined, 'repo,gist').oauth.refresh({ credential: initial.credentials })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
  });
  it('does not retain the already-invalid old pair if provider refresh returns an incomplete or unchanged pair', async () => {
    const initial = await setup().oauth.exchange({ ...request, code: 'isolated-code' });
    await expect(setup().oauth.refresh({ credential: initial.credentials })).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    await expect(setup({ access_token: 'isolated-new', token_type: 'bearer', scope: 'repo' }).oauth.refresh({ credential: initial.credentials })).rejects.toMatchObject({ code: 'AUTH_REVOKED' });
  });
  it('blocks expired refresh token before I/O', async () => {
    const initial = await setup().oauth.exchange({ ...request, code: 'isolated-code' }); const { oauth, transport } = setup();
    await expect(oauth.refresh({ credential: { ...initial.credentials, refreshExpiresAt: '2020-01-01T00:00:00Z' } })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' }); expect(transport).not.toHaveBeenCalled();
  });
  it('revokes only the current token using client authentication and a single DELETE', async () => {
    const transport = vi.fn<GitHubTransport>(async (url, init) => {
      expect(url).toBe('https://api.github.com/applications/isolated-client/token'); expect(init.method).toBe('DELETE');
      expect(JSON.parse(init.body as string)).toEqual({ access_token: 'isolated-access' });
      expect(new Headers(init.headers).get('authorization')).toBe('Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64'));
      return new Response(null, { status: 204 });
    });
    await new GitHubOAuthClient(config, new GitHubHttpClient(transport)).revoke({ tokenMode: 'OAUTH_APP', accessToken: 'isolated-access' }); expect(transport).toHaveBeenCalledTimes(1);
  });
});
