import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { GoogleApiError, GoogleHttpClient } from '../google/google-http.client';
import { GoogleOAuthClient } from '../google/google-oauth.client';
import { calendarManifest, CALENDAR_SCOPES } from './calendar-manifest';
import { prepareCalendarEvent, normalizeCalendarEvent, calendarReadbackEvidence } from './calendar-event';

const base = 'https://www.googleapis.com/calendar/v3/calendars/';
export class GoogleCalendarProviderAdapter implements ProviderAdapter {
  constructor(private readonly oauth: GoogleOAuthClient, private readonly http: GoogleHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'google_calendar', name: 'Google Calendar', description: 'Google Calendar REST; real-account acceptance is separate.',
    version: '0.2.0', connectorSdkVersion: '0.1.0', providerType: 'calendar', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'READ_CALENDAR_EVENT', supportsRefresh: true, supportsRevoke: true, supportsPKCE: true, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(calendarManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.oauth.start(input.request) };
    const token = await this.oauth.exchange(input.request); const actual = await this.primary(token.credentials);
    token.credentials.calendarId = actual;
    const scopes = new Set(token.credentials.scopes.split(/\s+/));
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: actual,
      grantedCapabilities: calendarManifest.capabilities.filter((c) => c.oauthScopes.every((s) => scopes.has(s))).map((c) => c.key) } };
  }
  refresh(input: CredentialRefreshRequest) { return this.oauth.refresh(input); }
  async revoke(input: ConnectorRequest) { await this.oauth.revoke(this.credentials(input)); }
  async health(input?: ConnectorRequest) {
    if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    const credential = this.credentials(input);
    if (await this.primary(credential) !== credential.calendarId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() };
  }
  async read(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (input.capability !== 'READ_CALENDAR_EVENT' || (input.input.calendarId !== undefined && input.input.calendarId !== credential.calendarId)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const path = this.eventsPath(credential.calendarId);
    if (input.input.eventId) return { ok: true, data: { events: [normalizeCalendarEvent(await this.api(path + '/' + this.id(input.input.eventId), credential), credential.calendarId)] } };
    const max = input.input.maxItems ?? 20;
    if (!Number.isSafeInteger(max) || (max as number) < 1 || (max as number) > 50) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const query = new URLSearchParams({ maxResults: String(max), singleEvents: 'true', showDeleted: 'false' });
    for (const field of ['timeMin', 'timeMax', 'pageToken']) if (input.input[field] !== undefined) {
      if (typeof input.input[field] !== 'string' || (input.input[field] as string).length > 500
        || (field !== 'pageToken' && !Number.isFinite(Date.parse(input.input[field] as string)))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      query.set(field, input.input[field] as string);
    }
    const result = await this.api(path + '?' + query, credential);
    if (result.items !== undefined && !Array.isArray(result.items)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { ok: true, data: { events: (result.items as Record<string, unknown>[] | undefined ?? []).slice(0, max as number).map((event) => normalizeCalendarEvent(event, credential.calendarId)),
      ...(typeof result.nextPageToken === 'string' ? { nextPageToken: result.nextPageToken } : {}) } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (!['CREATE_CALENDAR_EVENT', 'UPDATE_CALENDAR_EVENT'].includes(input.capability)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const update = input.capability === 'UPDATE_CALENDAR_EVENT';
    const desired = prepareCalendarEvent(input.input, credential.calendarId, input.idempotencyKey, update);
    let previous: Record<string, unknown> = {};
    try {
      if (await this.primary(credential) !== desired.calendarId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      if (update) { previous = await this.api(this.eventsPath(desired.calendarId) + '/' + this.id(desired.eventId), credential);
        if (previous.etag !== desired.etag || previous.status !== 'confirmed') throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    } catch (error) { throw new ProviderRuntimeError(error instanceof ProviderRuntimeError ? error.code : 'PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH'); }
    const privateProperties = ((previous.extendedProperties as { private?: Record<string, string> } | undefined)?.private ?? {});
    const body = { ...(update ? {} : { id: desired.eventId }), summary: desired.title, start: desired.start, end: desired.end,
      attendees: desired.attendees.map((email) => ({ email })), extendedProperties: { private: { ...privateProperties, lazyArmorOperation: desired.operationKey } } };
    const path = this.eventsPath(desired.calendarId) + (update ? '/' + this.id(desired.eventId) : '') + '?sendUpdates=' + desired.sendUpdates;
    try { const created = await this.api(path, credential, { method: update ? 'PATCH' : 'POST',
      headers: update ? { 'If-Match': desired.etag! } : {}, body: JSON.stringify(body) }, true);
      if (created.id !== desired.eventId) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    } catch (error) { if (!(error instanceof GoogleApiError && error.httpStatus === 409 && !update)) throw error; }
    // Includes POST success and duplicate-ID response: only read, never repeat mutation.
    try { return await this.readback(credential, desired); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertScopes(input, credential);
    if (!['CREATE_CALENDAR_EVENT', 'UPDATE_CALENDAR_EVENT'].includes(input.capability)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const desired = prepareCalendarEvent(input.input, credential.calendarId, input.idempotencyKey, input.capability === 'UPDATE_CALENDAR_EVENT');
    return this.readback(credential, desired);
  }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }
  private async readback(credential: Record<string, string>, desired: ReturnType<typeof prepareCalendarEvent>) {
    const actual = normalizeCalendarEvent(await this.api(this.eventsPath(desired.calendarId) + '/' + this.id(desired.eventId), credential), desired.calendarId);
    return { ok: true, data: { eventId: actual.eventId, calendarId: actual.calendarId, verificationEvidence: calendarReadbackEvidence(actual, desired) } };
  }
  private async primary(credential: Record<string, string>) {
    if (!credential.scopes?.split(/\s+/).includes(CALENDAR_SCOPES.metadata)) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
    const result = await this.api('primary', credential);
    if (typeof result.id !== 'string' || !/^[^\s/@]+@[^\s/]+$/.test(result.id) || result.id.length > 254) throw new ProviderRuntimeError('AUTH_EXPIRED', 'AFTER_DISPATCH');
    return result.id.toLowerCase();
  }
  private eventsPath(calendarId: string) { return encodeURIComponent(calendarId) + '/events'; }
  private id(value: unknown) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,1024}$/.test(value)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); return value; }
  private credentials(input: ConnectorRequest) { const data = input.credentials?.data;
    if (!data?.accessToken || !data.scopes) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); return data; }
  private assertScopes(input: ConnectorRequest, credential: Record<string, string>) { const capability = calendarManifest.capabilities.find((c) => c.key === input.capability);
    const scopes = new Set(credential.scopes.split(/\s+/)); if (!capability || !capability.oauthScopes.every((s) => scopes.has(s))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
    if (!credential.calendarId) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); }
  private api(path: string, credential: Record<string, string>, init: RequestInit = {}, write = false) {
    return this.http.request(base + path, { ...init, headers: { authorization: 'Bearer ' + credential.accessToken, 'content-type': 'application/json', ...init.headers } }, write);
  }
}
