import { ProviderRuntimeError, type ProviderAdapter, type ConnectorMetadata, type ConnectorRequest, type ProviderAuthorizationRequest,
  type CredentialRefreshRequest, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { GitHubHttpClient } from './github-http.client';
import { GitHubOAuthClient, gitHubOAuthScopes } from './github-oauth.client';
import { githubManifest } from './github-manifest';
import { githubRepositorySchema, normalizeGitHubRepository, normalizeGitHubResource, prepareGitHubAction, gitHubWriteEvidence, type GitHubRepository } from './github-resource';
const base = 'https://api.github.com';
export class GitHubProviderAdapter implements ProviderAdapter {
  constructor(private readonly oauth: GitHubOAuthClient, private readonly http: GitHubHttpClient) {}
  metadata(): ConnectorMetadata { return { key: 'github', name: 'GitHub', description: 'OAuth App REST adapter; real-account acceptance is separate.',
    version: '0.2.0', connectorSdkVersion: '0.1.0', providerType: 'content', productionStatus: 'BETA',
    authentication: { type: 'oauth2', oauth2: { authorizationCapability: 'READ_ISSUE', supportsRefresh: true, supportsRevoke: true, supportsPKCE: true, requiresRedirect: true } },
    supportsRefresh: true, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none', rateLimitStrategy: 'retry_after' }; }
  capabilities() { return structuredClone(githubManifest.capabilities); }
  async authorize(input: ProviderAuthorizationRequest) {
    if (input.phase === 'START') return { phase: 'START' as const, result: this.oauth.start(input.request) };
    const token = await this.oauth.exchange(input.request); const scopes = gitHubOAuthScopes(token.credentials.scopes);
    let repositories: GitHubRepository[] = [];
    if (scopes.includes('repo')) {
      const response = await this.http.request(base + '/user/repos?per_page=100&page=1&sort=full_name&affiliation=owner,collaborator,organization_member', this.init(token.credentials));
      if (!Array.isArray(response.data) || response.data.length > 100) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      repositories = response.data.map((raw) => { const normalized = normalizeGitHubRepository(raw as Record<string, unknown>);
        return { id: normalized.repositoryId, owner: normalized.owner, name: normalized.name }; });
    }
    token.credentials.repositories = JSON.stringify(repositories);
    return { phase: 'CALLBACK' as const, result: { ...token, externalAccountName: token.credentials.githubLogin,
      grantedCapabilities: scopes.includes('repo') && repositories.length ? githubManifest.capabilities.map((c) => c.key) : [] } };
  }
  refresh(input: CredentialRefreshRequest) { return this.oauth.refresh(input); }
  revoke(input: ConnectorRequest) { return this.oauth.revoke(this.credentials(input)); }
  async health(input?: ConnectorRequest) {
    if (!input) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    await this.oauth.identity(this.credentials(input));
    return { status: 'healthy' as const, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() };
  }
  async read(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, false);
    const repository = this.repository(input.input.repository, credential);
    if ((input.capability === 'READ_WORKFLOW_STATUS' && input.input.number !== undefined)
      || (input.capability !== 'READ_WORKFLOW_STATUS' && input.input.runId !== undefined)
      || (input.input.number !== undefined && input.input.runId !== undefined)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    await this.oauth.identity(credential);
    const actualRepo = normalizeGitHubRepository(await this.api(this.repoPath(repository), credential), repository);
    const kind = input.capability === 'READ_ISSUE' ? 'Issue' : input.capability === 'READ_PULL_REQUEST' ? 'PullRequest' : 'Workflow';
    const suffix = kind === 'Issue' ? '/issues' : kind === 'PullRequest' ? '/pulls' : '/actions/runs';
    const id = input.input.number ?? input.input.runId;
    let records: Record<string, unknown>[];
    if (id !== undefined) { this.positive(id); records = [await this.api(this.repoPath(repository) + suffix + '/' + id, credential)]; }
    else {
      const limit = input.input.maxItems ?? 20; this.positive(limit); if ((limit as number) > 50) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      const result = (await this.http.request(base + this.repoPath(repository) + suffix + '?per_page=' + limit + (kind === 'Workflow' ? '' : '&state=all'), this.init(credential))).data;
      const values = kind === 'Workflow' && result && !Array.isArray(result) ? result.workflow_runs : result;
      if (!Array.isArray(values) || values.length > (limit as number)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      records = values.filter((raw) => kind !== 'Issue' || (raw as Record<string, unknown>).pull_request === undefined) as Record<string, unknown>[];
    }
    return { ok: true, data: { resources: [actualRepo, ...records.map((raw) => normalizeGitHubResource(raw, repository, kind))] } };
  }
  async execute(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const comment = input.capability === 'CREATE_COMMENT'; const desired = prepareGitHubAction(input.input, input.idempotencyKey, comment);
    this.repository(desired.repository, credential);
    try {
      await this.oauth.identity(credential);
      const actual = normalizeGitHubRepository(await this.api(this.repoPath(desired.repository), credential), desired.repository);
      if (actual.private !== (desired.visibility === 'private')) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      if (comment) { const target = await this.api(this.repoPath(desired.repository) + '/issues/' + desired.issueNumber, credential);
        if (target.number !== desired.issueNumber || (target.pull_request !== undefined) !== (desired.targetKind === 'PULL_REQUEST')
          || target.url !== base + this.repoPath(desired.repository) + '/issues/' + desired.issueNumber) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    } catch (error) { throw new ProviderRuntimeError(error instanceof ProviderRuntimeError ? error.code : 'PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH',
      error instanceof ProviderRuntimeError ? error.retryAfterMs : null); }
    const path = this.repoPath(desired.repository) + '/issues' + (comment ? '/' + desired.issueNumber + '/comments' : '');
    const result = await this.api(path, credential, { method: 'POST', body: JSON.stringify({ body: desired.body, ...(!comment ? { title: desired.title } : {}) }) }, true);
    if (!Number.isSafeInteger(result.id) || (result.id as number) <= 0 || (!comment && (!Number.isSafeInteger(result.number) || (result.number as number) <= 0)))
      throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    try { const raw = await this.api(this.repoPath(desired.repository) + '/issues/' + (comment ? 'comments/' + result.id : result.number), credential);
      if (raw.id !== result.id || (!comment && raw.number !== result.number)) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      return this.evidence(raw, desired, credential, comment); }
    catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
  }
  async lookupOperation(input: ConnectorRequest) {
    const credential = this.credentials(input); this.assertCapability(input, credential, true);
    const comment = input.capability === 'CREATE_COMMENT'; const desired = prepareGitHubAction(input.input, input.idempotencyKey, comment);
    this.repository(desired.repository, credential);
    await this.oauth.identity(credential);
    const actual = normalizeGitHubRepository(await this.api(this.repoPath(desired.repository), credential), desired.repository);
    if (actual.private !== (desired.visibility === 'private')) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    const path = this.repoPath(desired.repository) + '/issues' + (comment ? '/' + desired.issueNumber + '/comments?per_page=100' : '?state=all&sort=created&direction=desc&per_page=100');
    const data = (await this.http.request(base + path, this.init(credential))).data;
    if (!Array.isArray(data) || data.length > 100) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    const matches = data.filter((raw) => gitHubWriteEvidence(raw as Record<string, unknown>, desired, credential.githubUserId, comment).matched);
    // Marker alone is not proof; all approved fields / author / target must match uniquely.
    // Not found within this bounded page is UNKNOWN, never permission to POST again.
    if (matches.length !== 1) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    const raw = matches[0] as Record<string, unknown>;
    const detail = await this.api(this.repoPath(desired.repository) + '/issues/' + (comment ? 'comments/' + raw.id : raw.number), credential);
    if (detail.id !== raw.id || (!comment && detail.number !== raw.number)) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
    return this.evidence(detail, desired, credential, comment);
  }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data), method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }
  private evidence(raw: Record<string, unknown>, desired: ReturnType<typeof prepareGitHubAction>, credential: Record<string, string>, comment: boolean) {
    return { ok: true, data: { resourceId: String(raw.id), repositoryId: desired.repository.id,
      verificationEvidence: gitHubWriteEvidence(raw, desired, credential.githubUserId, comment) } };
  }
  private repository(value: unknown, credential: Record<string, string>) {
    const parsed = githubRepositorySchema.safeParse(value);
    if (!parsed.success) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    let allowed: unknown; try { allowed = JSON.parse(credential.repositories); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    if (!Array.isArray(allowed) || allowed.length > 100 || !allowed.some((r) => r && r.id === parsed.data.id
      && r.owner?.toLowerCase() === parsed.data.owner.toLowerCase() && r.name?.toLowerCase() === parsed.data.name.toLowerCase())) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return parsed.data;
  }
  private credentials(input: ConnectorRequest) {
    const data = input.credentials?.data;
    if (!data?.accessToken || data.tokenMode !== 'OAUTH_APP' || !/^[1-9][0-9]*$/.test(data.githubUserId ?? '')) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); return data;
  }
  private assertCapability(input: ConnectorRequest, credential: Record<string, string>, write: boolean) {
    const definition = githubManifest.capabilities.find((c) => c.key === input.capability);
    if (!definition || (definition.operation === 'execute') !== write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if (!gitHubOAuthScopes(credential.scopes).includes('repo')) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
  }
  private positive(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
  private repoPath(repository: GitHubRepository) { return '/repos/' + repository.owner + '/' + repository.name; }
  private init(credential: Record<string, string>) { return { headers: { authorization: 'Bearer ' + credential.accessToken, 'content-type': 'application/json' } }; }
  private async api(path: string, credential: Record<string, string>, init: RequestInit = {}, write = false) {
    return (await this.http.object(base + path, { ...init, headers: { ...this.init(credential).headers, ...init.headers } }, write)).data;
  }
}
