import { describe, expect, it } from 'vitest';
import { GMAIL_CALLBACK_PATH, resolveGmailOAuthConfig } from './index';
const config = { GMAIL_OAUTH_CLIENT_ID: 'isolated-client.apps.googleusercontent.com', GMAIL_OAUTH_CLIENT_SECRET: 'isolated-secret-only',
  GMAIL_OAUTH_REDIRECT_URI: 'https://api.example.test' + GMAIL_CALLBACK_PATH };
describe('Gmail OAuth configuration contract', () => {
  it('disables Gmail when all credentials are missing or empty', () => {
    expect(resolveGmailOAuthConfig({})).toBeNull();
    expect(resolveGmailOAuthConfig({ GMAIL_OAUTH_CLIENT_ID: '', GMAIL_OAUTH_CLIENT_SECRET: '', GMAIL_OAUTH_REDIRECT_URI: '' })).toBeNull();
  });
  it('accepts only a complete HTTPS backend callback configuration', () => {
    expect(resolveGmailOAuthConfig(config)?.redirectUri).toBe(config.GMAIL_OAUTH_REDIRECT_URI);
  });
  it.each(Object.keys(config) as Array<keyof typeof config>)('fails closed for missing %s without exposing secret values', (key) => {
    try { resolveGmailOAuthConfig({ ...config, [key]: '' }); throw new Error('Expected rejection'); }
    catch (error) { expect(String(error)).not.toContain(config.GMAIL_OAUTH_CLIENT_SECRET); expect(String(error)).toContain('GMAIL'); }
  });
  it.each(['http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://user:password@api.example.test'])('rejects unsafe callback origin %s', (origin) => {
    expect(() => resolveGmailOAuthConfig({ ...config, GMAIL_OAUTH_REDIRECT_URI: origin + GMAIL_CALLBACK_PATH })).toThrow();
  });
  it.each(['/frontend/callback', GMAIL_CALLBACK_PATH + '?next=evil', GMAIL_CALLBACK_PATH + '#fragment'])('rejects non-exact backend callback %s', (path) => {
    expect(() => resolveGmailOAuthConfig({ ...config, GMAIL_OAUTH_REDIRECT_URI: 'https://api.example.test' + path })).toThrow();
  });
});
