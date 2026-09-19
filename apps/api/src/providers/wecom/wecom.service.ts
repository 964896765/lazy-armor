import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WECOM_CALLBACK_PATH, resolveWeComAppConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { WeComAuthClient } from './wecom-auth';
import { WeComHttpClient, WECOM_TRANSPORT, type WeComTransport } from './wecom-http.client';
import { WeComProviderAdapter } from './wecom.adapter';
import { AWAITING_WECOM_CREDENTIALS, AWAITING_WECOM_EVENT_EVIDENCE, AWAITING_WECOM_OAUTH_EVIDENCE, wecomEvidence, wecomManifest, wecomPolicy } from './wecom-manifest';

@Injectable()
export class WeComService implements OnModuleInit {
  private readonly appConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(WECOM_TRANSPORT) private readonly transport: WeComTransport) {
    this.appConfig = resolveWeComAppConfig({ WECOM_CORP_ID: config.get('WECOM_CORP_ID'), WECOM_AGENT_ID: config.get('WECOM_AGENT_ID'),
      WECOM_APP_SECRET: config.get('WECOM_APP_SECRET'), WECOM_OAUTH_REDIRECT_URI: config.get('WECOM_OAUTH_REDIRECT_URI'),
      WECOM_CALLBACK_TOKEN: config.get('WECOM_CALLBACK_TOKEN') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.appConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: wecomManifest, evidence: wecomEvidence, policy: wecomPolicy });
    if (!this.appConfig) return;
    const http = new WeComHttpClient(this.transport);
    const adapter = new WeComProviderAdapter(new WeComAuthClient(this.appConfig, http), http);
    this.registry.register(this.runtime.bridge(adapter, wecomManifest, wecomPolicy));
    await this.catalog.sync();
  }
  status() { return { providerKey: 'wecom', appConfigured: Boolean(this.appConfig), implementation: this.appConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: this.appConfig ? AWAITING_WECOM_OAUTH_EVIDENCE : AWAITING_WECOM_CREDENTIALS, eventAcceptance: AWAITING_WECOM_EVENT_EVIDENCE,
    callbackPath: WECOM_CALLBACK_PATH }; }
  private sessions() { if (!this.appConfig) throw new ServiceUnavailableException('WECOM_APP_NOT_CONFIGURED');
    return new GoogleOAuthSessions({ clientId: this.appConfig.corpId, clientSecret: this.appConfig.appSecret, redirectUri: this.appConfig.redirectUri }, 'wecom', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: { capability: string; [key: string]: unknown }) {
    this.sessions();
    const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'wecom') throw new ForbiddenException('An owned WeCom connection is required');
    const { capability, ...readInput } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `wecom-read:${newId()}` });
    const result = [];
    for (const resource of Array.isArray(read.data.resources) ? read.data.resources : []) {
      const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const calendar = capability === 'WECOM_CALENDAR_READ';
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'wecom', connectionId,
        externalEventKey: calendar ? `v1:${connectionId}:${payload.calendarId}:${payload.eventId}:${hash}`
          : `v1:${connectionId}:${payload.corpId}:${payload.resourceType}:${payload.resourceId}:${hash}`,
        parserKey: calendar ? 'generic.calendar-event.v1' : 'generic.wecom-resource.v1', resourceHint: calendar ? 'CalendarEvent' : payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: payload.updatedAt as string });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
        verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
  async observeEvent(userId: string, connectionId: string, resource: Record<string, JsonValue>) {
    const payload = resource; const hash = realityValueHash(payload);
    const observation = await this.pipeline.ingest(userId, { sourceMode: 'WEBHOOK', providerKey: 'wecom', connectionId,
      externalEventKey: `webhook:${connectionId}:${payload.resourceId}:${hash}`, parserKey: 'generic.wecom-resource.v1', resourceHint: payload.resourceType as string,
      payload, evidenceHash: hash, observedAt: new Date().toISOString(), occurredAt: payload.updatedAt as string });
    const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
      verifiedBy: 'wecom_signed_event', verificationMethod: 'SIGNATURE_VERIFIED' }));
    return { ...observation, truth };
  }
}
