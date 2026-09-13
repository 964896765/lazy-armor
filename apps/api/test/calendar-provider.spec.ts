import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { providerDefinitionHash, validateProviderRuntimePolicy } from '@lazy-armor/connector-sdk';
import { GOOGLE_CALENDAR_CALLBACK_PATH } from '@lazy-armor/config';
import { parseAndNormalizeObservation } from '@lazy-armor/plan-schema';
import { GoogleHttpClient } from '../src/providers/google/google-http.client';
import { GoogleOAuthClient } from '../src/providers/google/google-oauth.client';
import { GoogleCalendarProviderAdapter } from '../src/providers/calendar/calendar.adapter';
import { calendarManifest, calendarEvidence, calendarPolicy, CALENDAR_SCOPES } from '../src/providers/calendar/calendar-manifest';
import { prepareCalendarEvent, normalizeCalendarEvent } from '../src/providers/calendar/calendar-event';
import { GoogleCalendarService } from '../src/providers/calendar/calendar.service';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
const config = { clientId: 'isolated.apps.googleusercontent.com', clientSecret: 'isolated-secret', redirectUri: 'https://api.example.test' + GOOGLE_CALENDAR_CALLBACK_PATH };
const credentials = { accessToken: 'isolated', refreshToken: 'isolated-refresh', scopes: Object.values(CALENDAR_SCOPES).join(' '), calendarId: 'owner@example.test' };
const approved = { calendarId: credentials.calendarId, title: 'Meeting', start: { dateTime: '2026-09-15T09:00:00+08:00', timeZone: 'Asia/Shanghai' },
  end: { dateTime: '2026-09-15T10:00:00+08:00', timeZone: 'Asia/Shanghai' }, attendees: ['guest@example.test'], sendUpdates: 'all' as const };
const input = { capability: 'CREATE_CALENDAR_EVENT', requestId: 'isolated', idempotencyKey: 'a'.repeat(64), credentials: { data: credentials }, input: { context: { calendarEvent: approved }, config: {} } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function event(change: Record<string, unknown> = {}) { return { id: 'la' + input.idempotencyKey, summary: approved.title, start: approved.start, end: approved.end,
  attendees: approved.attendees.map((email) => ({ email })), status: 'confirmed', etag: '"version1"', updated: '2026-09-13T06:00:00Z',
  extendedProperties: { private: { lazyArmorOperation: input.idempotencyKey, other: 'preserved' } }, ...change }; }
function adapter(transport: (url: string, init: RequestInit) => Promise<Response>) { const http = new GoogleHttpClient(transport); return new GoogleCalendarProviderAdapter(new GoogleOAuthClient(config, http, Object.values(CALENDAR_SCOPES)), http); }
describe('Calendar isolated provider contract, not real-account acceptance', () => {
  it('publishes capability foundation without enabling a fixture or making network calls when unconfigured', async () => {
    const runtime = { publish: vi.fn().mockResolvedValue({}) }; const transport = vi.fn(); const registry = createConnectorRegistry({ NODE_ENV: 'development' });
    const service = new GoogleCalendarService(new ConfigService({ NODE_ENV: 'development' }), registry, runtime as never, {} as never, {} as never, {} as never, {} as never, transport);
    await service.onModuleInit(); expect(runtime.publish).toHaveBeenCalledWith({ manifest: calendarManifest, evidence: calendarEvidence, policy: calendarPolicy });
    expect(registry.get('google_calendar').metadata().productionStatus).toBe('DISABLED'); expect(() => service.start('owner')).toThrow('CALENDAR_OAUTH_NOT_CONFIGURED');
    expect(service.status().realAccountAcceptance).toBe('NOT_VERIFIED'); expect(transport).not.toHaveBeenCalled();
  });
  it('binds reviewed manifests, precise scopes and conservative write contracts', () => {
    expect(calendarPolicy.evidence.hash).toBe(providerDefinitionHash(calendarEvidence)); expect(() => validateProviderRuntimePolicy(calendarPolicy, calendarManifest)).not.toThrow();
    expect(calendarManifest.capabilities).toHaveLength(3); expect(calendarManifest.capabilities.slice(1).every((c) => c.riskLevel === 'R3' && !c.sideEffectContract.supportsIdempotencyKey)).toBe(true);
  });
  it('reuses S256 token exchange and grants only actual Calendar scopes', async () => {
    const transport = vi.fn(async (url: string) => json(url.includes('/token') ? { token_type: 'Bearer', access_token: 'isolated', refresh_token: 'refresh', expires_in: 3600,
      scope: [CALENDAR_SCOPES.read, CALENDAR_SCOPES.metadata].join(' ') } : { id: credentials.calendarId })); const provider = adapter(transport);
    const start = await provider.authorize({ phase: 'START', request: { userId: 'owner', state: 'b'.repeat(48), codeVerifier: 'v'.repeat(64), redirectUri: config.redirectUri } });
    expect(start.phase === 'START' && new URL(start.result.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
    const result = await provider.authorize({ phase: 'CALLBACK', request: { userId: 'owner', state: 'b'.repeat(48), codeVerifier: 'v'.repeat(64), redirectUri: config.redirectUri, code: 'code' } });
    expect(result.phase === 'CALLBACK' && result.result.grantedCapabilities).toEqual(['READ_CALENDAR_EVENT']);
  });
  it('creates exactly once, reads by actual eventId and compares all approved fields', async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => json(url.endsWith('/primary') ? { id: credentials.calendarId } : event()));
    const provider = adapter(transport); const result = await provider.execute(input);
    expect((await provider.verify({ request: input, result, policy: calendarPolicy.verificationPolicies[0] })).state).toBe('SUCCEEDED');
    const mutations = transport.mock.calls.filter(([, init]) => init.method === 'POST'); expect(mutations).toHaveLength(1);
    expect(mutations[0][0]).toContain('sendUpdates=all'); expect(transport.mock.calls.at(-1)?.[0]).toContain('/events/la' + input.idempotencyKey);
  });
  it.each([{ summary: 'changed' }, { attendeesOmitted: true }, { attendees: [] }, { status: 'cancelled' }, { extendedProperties: {} }])('never succeeds on mismatched or incomplete read-back %j', async (changed) => {
    const provider = adapter(async (url) => json(url.endsWith('/primary') ? { id: credentials.calendarId } : event(changed))); const result = await provider.execute(input);
    expect((await provider.verify({ request: input, result, policy: calendarPolicy.verificationPolicies[0] })).state).toBe('OUTCOME_UNKNOWN');
  });
  it('updates with approved If-Match and preserves other private properties', async () => {
    const transport = vi.fn(async (url: string) => json(url.endsWith('/primary') ? { id: credentials.calendarId } : event())); const provider = adapter(transport);
    const update = { ...input, capability: 'UPDATE_CALENDAR_EVENT', input: { context: { calendarEvent: { ...approved, eventId: event().id, etag: '"version1"' } } } };
    const result = await provider.execute(update); expect(result.data.verificationEvidence).toMatchObject({ matched: true });
    const mutation = transport.mock.calls.find(([, init]) => init.method === 'PATCH')!;
    expect(mutation[1].headers).toMatchObject({ 'If-Match': '"version1"' }); expect(JSON.parse(mutation[1].body as string).extendedProperties.private.other).toBe('preserved');
  });
  it('rejects a changed ETag, account, permissions or invalid time before any mutation', async () => {
    const transport = vi.fn(async (url: string) => json(url.endsWith('/primary') ? { id: credentials.calendarId } : event())); const provider = adapter(transport);
    await expect(provider.execute({ ...input, credentials: { data: { ...credentials, scopes: CALENDAR_SCOPES.read } } })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
    await expect(provider.execute({ ...input, input: { context: { calendarEvent: { ...approved, calendarId: 'other@example.test' } } } })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(provider.execute({ ...input, capability: 'UPDATE_CALENDAR_EVENT', input: { context: { calendarEvent: { ...approved, eventId: event().id, etag: '"old"' } } } })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    expect(() => prepareCalendarEvent({ context: { calendarEvent: { ...approved, end: approved.start } } }, credentials.calendarId, input.idempotencyKey)).toThrow();
    expect(transport.mock.calls.every(([, init]) => !['POST', 'PATCH'].includes(init.method!))).toBe(true);
  });
  it('does not treat a read-back 403 as proof that the preceding write had no effect', async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => url.endsWith('/primary') ? json({ id: credentials.calendarId })
      : init.method === 'POST' ? json({ id: event().id }) : json({ error: { errors: [{ reason: 'forbidden' }] } }, 403));
    await expect(adapter(transport).execute(input)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', phase: 'AFTER_DISPATCH', definitiveNoEffect: false });
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('handles duplicate IDs by read-back only and never retries a possibly effected network loss', async () => {
    let disconnected = false; const transport = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/primary')) return json({ id: credentials.calendarId });
      if (init.method === 'POST') { if (disconnected) throw new TypeError('lost response'); return json({ error: { errors: [{ reason: 'duplicate' }] } }, 409); } return json(event());
    }); const provider = adapter(transport); expect((await provider.execute(input)).data.verificationEvidence).toMatchObject({ matched: true });
    disconnected = true; await expect(provider.execute(input)).rejects.toMatchObject({ phase: 'AFTER_DISPATCH', code: 'NETWORK_ERROR' });
    const before = transport.mock.calls.length; await provider.lookupOperation(input); expect(transport.mock.calls.slice(before).every(([, init]) => init.method !== 'POST')).toBe(true);
  });
  it('reads bounded events and produces account-scoped Generic CalendarEvent facts', async () => {
    const provider = adapter(async () => json({ items: [event()] })); const result = await provider.read({ ...input, capability: 'READ_CALENDAR_EVENT', input: { maxItems: 1 } });
    const payload = normalizeCalendarEvent(event(), credentials.calendarId); expect(result.data.events).toHaveLength(1);
    const observation = { sourceMode: 'OFFICIAL_API' as const, providerKey: 'google_calendar', connectionId: 'one', externalEventKey: 'event',
      parserKey: 'generic.calendar-event.v1' as const, resourceHint: 'CalendarEvent', payload, evidenceHash: 'f'.repeat(64), observedAt: new Date().toISOString() };
    expect(parseAndNormalizeObservation(observation)[0].factKey).toBe('calendar_event.schedule');
    expect(parseAndNormalizeObservation(observation)[0].subjectKey).not.toBe(parseAndNormalizeObservation({ ...observation, connectionId: 'two' })[0].subjectKey);
  });
});
