import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GOOGLE_CALENDAR_CALLBACK_PATH, resolveGoogleCalendarOAuthConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GOOGLE_TRANSPORT, GoogleHttpClient, type GoogleTransport } from '../google/google-http.client';
import { GoogleOAuthClient } from '../google/google-oauth.client';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { GoogleCalendarProviderAdapter } from './calendar.adapter';
import { calendarManifest, calendarEvidence, calendarPolicy, CALENDAR_SCOPES } from './calendar-manifest';

@Injectable()
export class GoogleCalendarService implements OnModuleInit {
  private readonly oauthConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(GOOGLE_TRANSPORT) private readonly transport: GoogleTransport) {
    this.oauthConfig = resolveGoogleCalendarOAuthConfig({ GMAIL_OAUTH_CLIENT_ID: config.get('GMAIL_OAUTH_CLIENT_ID'), GMAIL_OAUTH_CLIENT_SECRET: config.get('GMAIL_OAUTH_CLIENT_SECRET'),
      GMAIL_OAUTH_REDIRECT_URI: config.get('GMAIL_OAUTH_REDIRECT_URI'), GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: config.get('GOOGLE_CALENDAR_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.oauthConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: calendarManifest, evidence: calendarEvidence, policy: calendarPolicy });
    if (!this.oauthConfig) return;
    const http = new GoogleHttpClient(this.transport);
    const adapter = new GoogleCalendarProviderAdapter(new GoogleOAuthClient(this.oauthConfig, http, Object.values(CALENDAR_SCOPES)), http);
    this.registry.register(this.runtime.bridge(adapter, calendarManifest, calendarPolicy)); await this.catalog.sync();
  }
  status() { return { providerKey: 'google_calendar', oauthConfigured: Boolean(this.oauthConfig), implementation: this.oauthConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: 'NOT_VERIFIED', callbackPath: GOOGLE_CALENDAR_CALLBACK_PATH }; }
  private sessions() { if (!this.oauthConfig) throw new ServiceUnavailableException('CALENDAR_OAUTH_NOT_CONFIGURED');
    return new GoogleOAuthSessions(this.oauthConfig, 'google_calendar', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: { eventId?: string; maxItems?: number; timeMin?: string; timeMax?: string; pageToken?: string }) {
    this.sessions(); const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'google_calendar') throw new ForbiddenException('An owned Google Calendar connection is required');
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability: 'READ_CALENDAR_EVENT', input, requestId: `calendar-read:${connectionId}:${Date.now()}` });
    const result = [];
    for (const event of Array.isArray(read.data.events) ? read.data.events : []) {
      const payload = event as Record<string, JsonValue>; const hash = realityValueHash(payload);
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'google_calendar', connectionId,
        externalEventKey: `${connectionId}:${payload.calendarId}:${payload.eventId}:${hash}`, parserKey: 'generic.calendar-event.v1', resourceHint: 'CalendarEvent',
        payload, evidenceHash: hash, observedAt: new Date().toISOString(), occurredAt: payload.updatedAt as string });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
}
