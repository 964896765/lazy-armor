import { ForbiddenException, Inject, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GITHUB_CALLBACK_PATH, resolveGitHubOAuthConfig } from '@lazy-armor/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { realityValueHash, type JsonValue } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { ConnectionsService } from '../../connections/connections.service';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { RealityPipelineService } from '../../reality-pipeline/reality-pipeline.service';
import { GoogleOAuthSessions } from '../google/google-oauth.sessions';
import { GITHUB_TRANSPORT, GitHubHttpClient, type GitHubTransport } from './github-http.client';
import { GitHubOAuthClient } from './github-oauth.client';
import { GitHubProviderAdapter } from './github.adapter';
import { githubWebhookManifest, githubWebhookEvidence, githubWebhookPolicy } from './github-webhook-manifest';
import type { GitHubObservationDto } from './github.controller';
import type { ResourceReadProof } from '../../reality-pipeline/versioned-resource-truth.service';
import type { GitHubWebhookHint } from './github-webhook-hint';
import { ConnectorRateLimitCoordinator } from '../../infrastructure/connector-rate-limit-coordinator.service';

@Injectable()
export class GitHubService implements OnModuleInit {
  private readonly oauthConfig; private readonly legacyFixtureMode;
  constructor(config: ConfigService, private readonly registry: ConnectorRegistry, private readonly runtime: ProviderRuntimeService,
    private readonly catalog: ConnectorCatalogSyncService, private readonly connections: ConnectionsService,
    private readonly pipeline: RealityPipelineService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(GITHUB_TRANSPORT) private readonly transport: GitHubTransport, private readonly rateLimits: ConnectorRateLimitCoordinator) {
    this.oauthConfig = resolveGitHubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: config.get('GITHUB_OAUTH_CLIENT_ID'), GITHUB_OAUTH_CLIENT_SECRET: config.get('GITHUB_OAUTH_CLIENT_SECRET'),
      GITHUB_OAUTH_REDIRECT_URI: config.get('GITHUB_OAUTH_REDIRECT_URI') });
    this.legacyFixtureMode = config.get('NODE_ENV') === 'test' && !this.oauthConfig;
  }
  async onModuleInit() {
    if (this.legacyFixtureMode) return;
    await this.runtime.publish({ manifest: githubWebhookManifest, evidence: githubWebhookEvidence, policy: githubWebhookPolicy });
    if (!this.oauthConfig) return;
    const http = new GitHubHttpClient(this.transport); const adapter = new GitHubProviderAdapter(new GitHubOAuthClient(this.oauthConfig, http), http, githubWebhookManifest);
    this.registry.register(this.runtime.bridge(adapter, githubWebhookManifest, githubWebhookPolicy)); await this.catalog.sync();
  }
  status() { return { providerKey: 'github', oauthConfigured: Boolean(this.oauthConfig), implementation: this.oauthConfig ? 'BETA' : 'DISABLED',
    realAccountAcceptance: 'NOT_VERIFIED', callbackPath: GITHUB_CALLBACK_PATH, webhookIngestion: 'SIGNED_REFRESH_HINT_IMPLEMENTED', authenticationMode: 'OAUTH_APP' }; }
  private sessions() { if (!this.oauthConfig) throw new ServiceUnavailableException('GITHUB_OAUTH_NOT_CONFIGURED');
    // This bridge is platform-independent callback/CAS storage, not the Google token client.
    return new GoogleOAuthSessions(this.oauthConfig, 'github', this.connections, this.db); }
  start(userId: string) { return this.sessions().start(userId); }
  callback(state: string, code?: string, error?: string) { return this.sessions().callback(state, code, error); }
  async observe(userId: string, connectionId: string, input: GitHubObservationDto) {
    return this.observeInternal(userId, connectionId, input);
  }
  async recoverObservationHealth(userId: string, connectionId: string) {
    // The existing health lifecycle rechecks credentials/account/scope and CAS;
    // its Runtime rate-limit gate must still admit the probe. No cooldown reset.
    const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'github' || connection.status === 'revoked') throw new ForbiddenException('An active owned GitHub connection is required');
    // HTTP reads honor provider Retry-After in the connection-level coordinator.
    // Admit recovery there before credentials/health I/O, then retain Runtime gates.
    await this.rateLimits.acquire({ provider: 'github', connectionId });
    return this.connections.validate(userId, connectionId);
  }
  async observeWebhookHint(userId: string, connectionId: string, hint: GitHubWebhookHint, assertLease: () => Promise<void>, lease: NonNullable<ResourceReadProof['acquisitionLease']>) {
    const { capability, repository, number, runId } = hint;
    return this.observeInternal(userId, connectionId, { capability, repository, number, runId }, hint, assertLease, lease);
  }
  private async observeInternal(userId: string, connectionId: string, input: GitHubObservationDto, expected?: GitHubWebhookHint, assertLease?: () => Promise<void>, lease?: ResourceReadProof['acquisitionLease']) {
    this.sessions(); const connection = await this.connections.get(userId, connectionId);
    if (connection.connectorId !== 'github') throw new ForbiddenException('An owned GitHub connection is required');
    const { capability, ...readInput } = input;
    const read = await this.connections.invokeConsumerRead(userId, connectionId, { capability, input: readInput, requestId: `github-read:${newId()}` });
    const resources = Array.isArray(read.data.resources) ? read.data.resources : [];
    // Validate the *actual* target before materializing even repository metadata.
    // A changed/moved/foreign resource ID cannot publish any portion of this hint.
    if (expected) {
      const targets = resources.filter((resource) => (resource as Record<string, unknown>).resourceType === expected.resourceType);
      const target = targets[0] as Record<string, unknown> | undefined;
      if (targets.length !== 1 || target?.resourceId !== String(expected.resourceId) || target.repositoryId !== expected.repository.id
        || (expected.number !== undefined && target.number !== expected.number)) throw new ForbiddenException('Webhook read-back target mismatch');
      await assertLease!();
    }
    const result = [];
    for (const resource of resources) {
      const payload = resource as Record<string, JsonValue>; const hash = realityValueHash(payload); const observedAt = new Date().toISOString();
      const observation = await this.pipeline.ingest(userId, { sourceMode: 'OFFICIAL_API', providerKey: 'github', connectionId,
        externalEventKey: `v2:${connectionId}:${payload.repositoryId}:${payload.resourceType}:${payload.resourceId}:${hash}`, parserKey: 'generic.repository-resource.v2', resourceHint: payload.resourceType as string,
        payload, evidenceHash: hash, observedAt, occurredAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null });
      const truth = []; for (const candidate of observation.candidates) truth.push(await this.pipeline.confirmCandidate(userId, candidate.id, {
        verifiedBy: 'authenticated_provider_read', verificationMethod: 'READ_BACK', readProof: { ...(read.data.acquisition as ResourceReadProof), ...(lease ? { acquisitionLease: lease } : {}) } }));
      result.push({ ...observation, truth });
    }
    return { observations: result };
  }
}
