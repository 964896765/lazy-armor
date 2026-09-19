import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DINGTALK_CALLBACK_PATH, resolveDingTalkAppConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { DingTalkAuthClient } from './dingtalk-auth';
import { DingTalkHttpClient, DINGTALK_TRANSPORT, type DingTalkTransport } from './dingtalk-http.client';
import { DingTalkProviderAdapter } from './dingtalk.adapter';
import { AWAITING_DINGTALK_CREDENTIALS, AWAITING_DINGTALK_EVENT_EVIDENCE, AWAITING_DINGTALK_OAUTH_EVIDENCE, dingtalkEvidence, dingtalkManifest, dingtalkPolicy } from './dingtalk-manifest';

@Injectable()
export class DingTalkService implements OnModuleInit {
  private readonly appConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(DINGTALK_TRANSPORT) private readonly transport: DingTalkTransport) {
    this.appConfig = resolveDingTalkAppConfig({ DINGTALK_APP_KEY: config.get('DINGTALK_APP_KEY'), DINGTALK_APP_SECRET: config.get('DINGTALK_APP_SECRET'),
      DINGTALK_OAUTH_REDIRECT_URI: config.get('DINGTALK_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.appConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: dingtalkManifest, evidence: dingtalkEvidence, policy: dingtalkPolicy });
    if (!this.appConfig) return;
    const http = new DingTalkHttpClient(this.transport);
    const adapter = new DingTalkProviderAdapter(new DingTalkAuthClient(this.appConfig, http), http);
    this.registry.register(this.runtime.bridge(adapter, dingtalkManifest, dingtalkPolicy));
    await this.catalog.sync();
  }
  status() { return { providerKey: 'dingtalk', appConfigured: Boolean(this.appConfig), implementation: this.appConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: this.appConfig ? AWAITING_DINGTALK_OAUTH_EVIDENCE : AWAITING_DINGTALK_CREDENTIALS, eventAcceptance: AWAITING_DINGTALK_EVENT_EVIDENCE,
    callbackPath: DINGTALK_CALLBACK_PATH }; }
  private sessions() { if (!this.appConfig) throw new ServiceUnavailableException('DINGTALK_APP_NOT_CONFIGURED');
    return new GoogleOAuthSessions({ clientId: this.appConfig.appKey, clientSecret: this.appConfig.appSecret, redirectUri: this.appConfig.redirectUri }, 'dingtalk', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: { capability: string; [key: string]: unknown }) {
    this.sessions();
    const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'dingtalk') throw new ForbiddenException('An owned DingTalk connection is required');
    const { capability, ...readInput } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `dingtalk-read:${newId()}` });
    const result = [];
    for (const resource of Array.isArray(read.data.resources) ? read.data.resources : []) {
      const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const calendar = capability === 'DINGTALK_CALENDAR_READ';
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'dingtalk', connectionId,
        externalEventKey: calendar ? `v1:${connectionId}:${payload.calendarId}:${payload.eventId}:${hash}`
          : `v1:${connectionId}:${payload.corpId}:${payload.resourceType}:${payload.resourceId}:${hash}`,
        parserKey: calendar ? 'generic.calendar-event.v1' : 'generic.dingtalk-resource.v1', resourceHint: calendar ? 'CalendarEvent' : payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: payload.updatedAt as string });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
        verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
  async observeEvent(userId: string, connectionId: string, resource: Record<string, JsonValue>) {
    const payload = resource; const hash = realityValueHash(payload);
    const observation = await this.pipeline.ingest(userId, { sourceMode: 'WEBHOOK', providerKey: 'dingtalk', connectionId,
      externalEventKey: `webhook:${connectionId}:${payload.resourceId}:${hash}`, parserKey: 'generic.dingtalk-resource.v1', resourceHint: payload.resourceType as string,
      payload, evidenceHash: hash, observedAt: new Date().toISOString(), occurredAt: payload.updatedAt as string });
    const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
      verifiedBy: 'dingtalk_signed_event', verificationMethod: 'SIGNATURE_VERIFIED' }));
    return { ...observation, truth };
  }
}
