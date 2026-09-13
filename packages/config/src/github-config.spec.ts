import { describe, expect, it } from 'vitest';
import { GITHUB_CALLBACK_PATH, resolveGitHubOAuthConfig, parseEnv } from './index';
const config = { GITHUB_OAUTH_CLIENT_ID: 'isolated-client', GITHUB_OAUTH_CLIENT_SECRET: 'isolated-github-secret', GITHUB_OAUTH_REDIRECT_URI: 'https://api.example.test' + GITHUB_CALLBACK_PATH };
describe('GitHub non-Secret configuration foundation, not an enabled provider', () => {
  it('is disabled with no configuration and uses independent GitHub credentials', () => {
    expect(resolveGitHubOAuthConfig({})).toBeNull(); expect(resolveGitHubOAuthConfig(config)).toEqual({ clientId: config.GITHUB_OAUTH_CLIENT_ID, clientSecret: config.GITHUB_OAUTH_CLIENT_SECRET, redirectUri: config.GITHUB_OAUTH_REDIRECT_URI });
  });
  it.each(Object.keys(config))('rejects partial configuration missing %s without exposing secrets', (key) => {
    const broken = { ...config, [key]: '' };
    let message = ''; try { resolveGitHubOAuthConfig(broken); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('GITHUB_OAUTH_'); expect(message).not.toContain(config.GITHUB_OAUTH_CLIENT_SECRET);
  });
  it.each(['http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@api.example.test'])('rejects unsafe callback origin %s', (origin) => {
    expect(() => resolveGitHubOAuthConfig({ ...config, GITHUB_OAUTH_REDIRECT_URI: origin + GITHUB_CALLBACK_PATH })).toThrow();
  });
  it.each(['/api/providers/google/oauth/gmail/callback', GITHUB_CALLBACK_PATH + '?next=evil', GITHUB_CALLBACK_PATH + '#fragment'])('rejects callback path/parameters %s', (path) => {
    expect(() => resolveGitHubOAuthConfig({ ...config, GITHUB_OAUTH_REDIRECT_URI: 'https://api.example.test' + path })).toThrow();
  });
  it('does not accept a placeholder credential', () => {
    expect(() => resolveGitHubOAuthConfig({ ...config, GITHUB_OAUTH_CLIENT_SECRET: 'inject-github-secret' })).toThrow();
  });
  it.each(['short', 'replace-with-a-long-webhook-secret-here'])('fails closed on unsafe webhook secret %s', (secret) => {
    expect(() => parseEnv({ ...process.env, GITHUB_WEBHOOK_SECRET: secret })).toThrow();
  });
});
