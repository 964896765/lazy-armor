import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FEISHU_CALLBACK_PATH, resolveFeishuAppConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { FeishuAuthClient } from './feishu-auth';
import { FeishuHttpClient, FEISHU_TRANSPORT, type FeishuTransport } from './feishu-http.client';
import { FeishuProviderAdapter } from './feishu.adapter';
import { AWAITING_FEISHU_CREDENTIALS, AWAITING_FEISHU_EVENT_EVIDENCE, AWAITING_FEISHU_OAUTH_EVIDENCE, feishuEvidence, feishuManifest, feishuPolicy } from './feishu-manifest';

@Injectable()
export class FeishuService implements OnModuleInit {
  private readonly appConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(FEISHU_TRANSPORT) private readonly transport: FeishuTransport) {
    this.appConfig = resolveFeishuAppConfig({ FEISHU_APP_ID: config.get('FEISHU_APP_ID'), FEISHU_APP_SECRET: config.get('FEISHU_APP_SECRET'),
      FEISHU_OAUTH_REDIRECT_URI: config.get('FEISHU_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.appConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: feishuManifest, evidence: feishuEvidence, policy: feishuPolicy });
    if (!this.appConfig) return;
    const http = new FeishuHttpClient(this.transport);
    const adapter = new FeishuProviderAdapter(new FeishuAuthClient(this.appConfig, http), http);
    this.registry.register(this.runtime.bridge(adapter, feishuManifest, feishuPolicy));
    await this.catalog.sync();
  }
  status() { return { providerKey: 'feishu', appConfigured: Boolean(this.appConfig), implementation: this.appConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: this.appConfig ? AWAITING_FEISHU_OAUTH_EVIDENCE : AWAITING_FEISHU_CREDENTIALS, eventAcceptance: AWAITING_FEISHU_EVENT_EVIDENCE,
    callbackPath: FEISHU_CALLBACK_PATH }; }
  private sessions() { if (!this.appConfig) throw new ServiceUnavailableException('FEISHU_APP_NOT_CONFIGURED');
    // Platform-independent callback/CAS storage; Feishu app config maps onto the
    // GoogleOAuthConfig shape (clientId/clientSecret are unused by the sessions).
    return new GoogleOAuthSessions({ clientId: this.appConfig.appId, clientSecret: this.appConfig.appSecret, redirectUri: this.appConfig.redirectUri }, 'feishu', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: { capability: string; [key: string]: unknown }) {
    this.sessions();
    const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'feishu') throw new ForbiddenException('An owned Feishu connection is required');
    const { capability, ...readInput } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `feishu-read:${newId()}` });
    const result = [];
    for (const resource of Array.isArray(read.data.resources) ? read.data.resources : []) {
      const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const calendar = capability === 'FEISHU_CALENDAR_READ';
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'feishu', connectionId,
        externalEventKey: calendar ? `v1:${connectionId}:${payload.calendarId}:${payload.eventId}:${hash}`
          : `v1:${connectionId}:${payload.tenantKey}:${payload.resourceType}:${payload.resourceId}:${hash}`,
        parserKey: calendar ? 'generic.calendar-event.v1' : 'generic.feishu-resource.v1', resourceHint: calendar ? 'CalendarEvent' : payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: payload.updatedAt as string });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
        verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
  async observeEvent(userId: string, connectionId: string, resource: Record<string, JsonValue>) {
    const payload = resource; const hash = realityValueHash(payload);
    const observation = await this.pipeline.ingest(userId, { sourceMode: 'WEBHOOK', providerKey: 'feishu', connectionId,
      externalEventKey: `webhook:${connectionId}:${payload.resourceId}:${hash}`, parserKey: 'generic.feishu-resource.v1', resourceHint: payload.resourceType as string,
      payload, evidenceHash: hash, observedAt: new Date().toISOString(), occurredAt: payload.updatedAt as string });
    const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
      verifiedBy: 'feishu_signed_event', verificationMethod: 'SIGNATURE_VERIFIED' }));
    return { ...observation, truth };
  }
}
