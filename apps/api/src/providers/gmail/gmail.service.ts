import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GMAIL_CALLBACK_PATH, resolveGmailOAuthConfig } from '@lazy-armor/config';
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
import { GmailProviderAdapter } from './gmail.adapter';
import { GMAIL_SCOPES, gmailManifest, gmailEvidence, gmailPolicy } from './gmail-manifest';

@Injectable()
export class GmailService implements OnModuleInit {
  private readonly oauthConfig;
  private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(GOOGLE_TRANSPORT) private readonly transport: GoogleTransport) {
    this.oauthConfig = resolveGmailOAuthConfig({ GMAIL_OAUTH_CLIENT_ID: config.get('GMAIL_OAUTH_CLIENT_ID'),
      GMAIL_OAUTH_CLIENT_SECRET: config.get('GMAIL_OAUTH_CLIENT_SECRET'), GMAIL_OAUTH_REDIRECT_URI: config.get('GMAIL_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.oauthConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: gmailManifest, evidence: gmailEvidence, policy: gmailPolicy });
    if (!this.oauthConfig) return;
    const http = new GoogleHttpClient(this.transport);
    this.registry.register(this.runtime.bridge(new GmailProviderAdapter(new GoogleOAuthClient(this.oauthConfig, http, Object.values(GMAIL_SCOPES)), http), gmailManifest, gmailPolicy));
    await this.catalog.sync();
  }
  status() { return { providerKey: 'gmail', oauthConfigured: Boolean(this.oauthConfig), implementation: this.oauthConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: 'NOT_VERIFIED', callbackPath: GMAIL_CALLBACK_PATH }; }
  start(userId: string) { return new GoogleOAuthSessions(this.requireConfig(), 'gmail', this.connections, this.db).start(userId); }
  async callback(state: string, code?: string, error?: string) {
    return new GoogleOAuthSessions(this.requireConfig(), 'gmail', this.connections, this.db).callback(state, code, error);
  }
  async observe(userId: string, connectionId: string, input: { capability: string; messageId?: string; maxItems?: number; q?: string; pageToken?: string }) {
    this.requireConfig();
    const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'gmail' || !['READ_EMAIL_METADATA', 'READ_EMAIL_BODY'].includes(input.capability)) throw new ForbiddenException('Gmail observation requires an owned Gmail read capability');
    const { capability, ...query } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: query, requestId: `gmail-read:${connectionId}:${Date.now()}` });
    const result = [];
    for (const message of Array.isArray(read.data.messages) ? read.data.messages : []) {
      const payload = message as Record<string, JsonValue>; const hash = realityValueHash(payload);
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'gmail', connectionId,
        externalEventKey: `${connectionId}:${payload.messageId}:${capability}:${hash}`, parserKey: 'generic.email-message.v1', resourceHint: 'EmailMessage',
        payload, evidenceHash: hash, observedAt: new Date().toISOString(), occurredAt: payload.occurredAt as string });
      const truth = [];
      for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
  private requireConfig() { if (!this.oauthConfig) throw new ServiceUnavailableException('GMAIL_OAUTH_NOT_CONFIGURED'); return this.oauthConfig; }
}
