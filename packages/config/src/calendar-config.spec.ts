import { describe, expect, it } from 'vitest';
import { GMAIL_CALLBACK_PATH, GOOGLE_CALENDAR_CALLBACK_PATH, resolveGoogleCalendarOAuthConfig } from './index';
const shared = { GMAIL_OAUTH_CLIENT_ID: 'isolated.apps.googleusercontent.com', GMAIL_OAUTH_CLIENT_SECRET: 'isolated-secret', GMAIL_OAUTH_REDIRECT_URI: 'https://api.example.test' + GMAIL_CALLBACK_PATH };
describe('Calendar reuses the existing Google OAuth configuration', () => {
  it('is disabled independently when its redirect is absent', () => { expect(resolveGoogleCalendarOAuthConfig({})).toBeNull(); expect(resolveGoogleCalendarOAuthConfig(shared)).toBeNull(); });
  it('shares client credentials but requires its own exact registered callback', () => {
    expect(resolveGoogleCalendarOAuthConfig({ ...shared, GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: 'https://api.example.test' + GOOGLE_CALENDAR_CALLBACK_PATH }))
      .toEqual({ clientId: shared.GMAIL_OAUTH_CLIENT_ID, clientSecret: shared.GMAIL_OAUTH_CLIENT_SECRET, redirectUri: 'https://api.example.test' + GOOGLE_CALENDAR_CALLBACK_PATH });
  });
  it('fails before I/O when shared credentials are absent', () => {
    expect(() => resolveGoogleCalendarOAuthConfig({ GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: 'https://api.example.test' + GOOGLE_CALENDAR_CALLBACK_PATH })).toThrow();
  });
  it.each(['http://api.example.test', 'https://localhost', 'https://user:password@api.example.test'])('rejects unsafe Calendar origin %s', (origin) => {
    expect(() => resolveGoogleCalendarOAuthConfig({ ...shared, GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: origin + GOOGLE_CALENDAR_CALLBACK_PATH })).toThrow();
  });
  it.each([GMAIL_CALLBACK_PATH, GOOGLE_CALENDAR_CALLBACK_PATH + '?next=evil', GOOGLE_CALENDAR_CALLBACK_PATH + '#fragment'])('rejects non-exact callback %s', (path) => {
    expect(() => resolveGoogleCalendarOAuthConfig({ ...shared, GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: 'https://api.example.test' + path })).toThrow();
  });
});
