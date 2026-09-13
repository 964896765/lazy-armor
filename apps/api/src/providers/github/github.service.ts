import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GITHUB_CALLBACK_PATH, resolveGitHubOAuthConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { GITHUB_TRANSPORT, GitHubHttpClient, type GitHubTransport } from './github-http.client';
import { GitHubOAuthClient } from './github-oauth.client';
import { GitHubProviderAdapter } from './github.adapter';
import { githubManifest, githubEvidence, githubPolicy } from './github-manifest';
import type { GitHubObservationDto } from './github.controller';

@Injectable()
export class GitHubService implements OnModuleInit {
  private readonly oauthConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(GITHUB_TRANSPORT) private readonly transport: GitHubTransport) {
    this.oauthConfig = resolveGitHubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: config.get('GITHUB_OAUTH_CLIENT_ID'), GITHUB_OAUTH_CLIENT_SECRET: config.get('GITHUB_OAUTH_CLIENT_SECRET'),
      GITHUB_OAUTH_REDIRECT_URI: config.get('GITHUB_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.oauthConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: githubManifest, evidence: githubEvidence, policy: githubPolicy });
    if (!this.oauthConfig) return;
    const http = new GitHubHttpClient(this.transport); const adapter = new GitHubProviderAdapter(new GitHubOAuthClient(this.oauthConfig, http), http);
    this.registry.register(this.runtime.bridge(adapter, githubManifest, githubPolicy)); await this.catalog.sync();
  }
  status() { return { providerKey: 'github', oauthConfigured: Boolean(this.oauthConfig), implementation: this.oauthConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: 'NOT_VERIFIED', callbackPath: GITHUB_CALLBACK_PATH, webhookIngestion: 'NOT_IMPLEMENTED', authenticationMode: 'OAUTH_APP' }; }
  private sessions() { if (!this.oauthConfig) throw new ServiceUnavailableException('GITHUB_OAUTH_NOT_CONFIGURED');
    // This bridge is platform-independent callback/CAS storage, not the Google token client.
    return new GoogleOAuthSessions(this.oauthConfig, 'github', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: GitHubObservationDto) {
    this.sessions(); const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'github') throw new ForbiddenException('An owned GitHub connection is required');
    const { capability, ...readInput } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `github-read:${connectionId}:${Date.now()}` });
    const result = [];
    for (const resource of Array.isArray(read.data.resources) ? read.data.resources : []) {
      const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'github', connectionId,
        externalEventKey: `${connectionId}:${payload.repositoryId}:${payload.resourceType}:${payload.resourceId}:${hash}`, parserKey: 'generic.repository-resource.v1', resourceHint: payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK' }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
}
