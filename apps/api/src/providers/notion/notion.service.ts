import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; import { NOTION_CALLBACK_PATH, resolveNotionOAuthConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk'; import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema'; import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../../common/database.module'; import { ConnectionsService } from '../../connections/connections.service'; import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service'; import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service'; import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import type { ResourceReadProof } from '../../reality-pipeline/versioned-resource-truth.service';
import { ProviderCapabilityRegistryService } from '../../provider-capabilities/provider-capability-registry.service';
import { NOTION_TRANSPORT, NotionHttpClient, type NotionTransport } from './notion-http.client'; import { NotionOAuthClient } from './notion-oauth.client'; import { NotionProviderAdapter } from './notion.adapter'; import { notionEvidence, notionManifest, notionPolicy } from './notion-manifest';
@Injectable()
export class NotionService implements OnModuleInit {
  private readonly oauthConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService, private readonly catalog: ConnectorCatalogSyncService,
    private readonly connections: ConnectionsService, private readonly pipeline: RealityPipelineService, private readonly capabilityRegistry: ProviderCapabilityRegistryService,
    @Inject(DATABASE) private readonly db: InjectedDatabase, @Inject(NOTION_TRANSPORT) private readonly transport: NotionTransport) {
    this.oauthConfig = resolveNotionOAuthConfig({ NOTION_OAUTH_CLIENT_ID: config.get('NOTION_OAUTH_CLIENT_ID'), NOTION_OAUTH_CLIENT_SECRET: config.get('NOTION_OAUTH_CLIENT_SECRET'), NOTION_OAUTH_REDIRECT_URI: config.get('NOTION_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.oauthConfig;
  }
  async onModuleInit() { if (this.legacyFixtureMode) return; await this.runtime.publish({ manifest: notionManifest, evidence: notionEvidence, policy: notionPolicy }); this.capabilityRegistry.installRevision(notionManifest);
    if (!this.oauthConfig) return; const http = new NotionHttpClient(this.transport); const adapter = new NotionProviderAdapter(new NotionOAuthClient(this.oauthConfig, http), http);
    this.registry.register(this.runtime.bridge(adapter, notionManifest, notionPolicy)); await this.catalog.sync(); }
  status() { return { providerKey: 'notion', oauthConfigured: Boolean(this.oauthConfig), implementation: this.oauthConfig ? 'BETA' : 'DISABLED', realAccountAcceptance: 'NOT_VERIFIED', callbackPath: NOTION_CALLBACK_PATH }; }
  private sessions() { if (!this.oauthConfig) throw new ServiceUnavailableException('NOTION_OAUTH_NOT_CONFIGURED'); return new GoogleOAuthSessions(this.oauthConfig, 'notion', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); } callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: { capability: 'READ_PAGE' | 'READ_DATA_SOURCE'; resourceId: string; includeRows?: boolean; maxItems?: number }) {
    this.sessions(); const connection = await this.connections.get(userId, connectionId); if (connection.connectorId !== 'notion') throw new ForbiddenException('An owned Notion connection is required');
    const { capability, ...readInput } = input; const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `notion-read:${newId()}` }); const result = [];
    for (const resource of Array.isArray(read.data.resources) ? read.data.resources : []) { const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'notion', connectionId,
        externalEventKey: `v1:${connectionId}:${payload.workspaceId}:${payload.resourceType}:${payload.resourceId}:${hash}`, parserKey: 'generic.document-resource.v1', resourceHint: payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: payload.updatedAt as string });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK', readProof: read.data.acquisition as unknown as ResourceReadProof }));
      result.push({ ...observation, truth }); }
    return { observations: result };
  }
}
