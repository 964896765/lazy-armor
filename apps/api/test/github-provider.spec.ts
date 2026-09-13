import { describe, expect, it, vi } from 'vitest';
import { validateProviderCapabilityManifest, validateProviderRuntimePolicy, validateConnectorManifest, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { RESOURCE_CATALOG, FACT_SCHEMA_CATALOG, parseAndNormalizeObservation, realityValueHash } from '@lazy-armor/plan-schema';
import { GitHubProviderAdapter } from '../src/providers/github/github.adapter';
import { GitHubHttpClient, type GitHubTransport } from '../src/providers/github/github-http.client';
import { GitHubOAuthClient } from '../src/providers/github/github-oauth.client';
import { githubManifest, githubPolicy } from '../src/providers/github/github-manifest';
import { prepareGitHubAction, normalizeGitHubResource } from '../src/providers/github/github-resource';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
const repository = { id: 42, owner: 'isolated-owner', name: 'isolated-repo' };
const root = 'https://api.github.com/repos/isolated-owner/isolated-repo';
const config = { clientId: 'isolated-client', clientSecret: 'isolated-secret', redirectUri: 'https://isolated.example/api/providers/github/oauth/callback' };
const credential = { accessToken: 'isolated-token', scopes: 'repo', tokenMode: 'OAUTH_APP', githubUserId: '7', githubLogin: 'isolated-owner', repositories: JSON.stringify([repository]) };
const key = 'a'.repeat(64); const approved = { repository, visibility: 'private', title: 'Approved issue', body: 'Approved details' };
const request = (capability = 'CREATE_ISSUE', fields: Record<string, unknown> = approved): ConnectorRequest => ({ capability,
  requestId: 'isolated-request', idempotencyKey: key, input: { context: { githubAction: fields } }, credentials: { data: credential } });
const rawIssue = { id: 99, number: 1, title: approved.title, body: prepareGitHubAction(request().input, key, false).body,
  state: 'open', user: { id: 7 }, url: root + '/issues/1', updated_at: '2026-09-13T10:00:00Z' };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
function setup(mutate?: (url: string, init: RequestInit) => Response | undefined) {
  const transport = vi.fn<GitHubTransport>(async (url, init) => mutate?.(url, init)
    ?? (url === 'https://api.github.com/user' ? json({ id: 7, login: 'isolated-owner' }, 200, { 'x-oauth-scopes': 'repo' })
      : url === root ? json({ ...repository, owner: { login: repository.owner }, full_name: repository.owner + '/' + repository.name, private: true })
        : url.includes('?') ? json([rawIssue]) : json(rawIssue)));
  const http = new GitHubHttpClient(transport); return { transport, adapter: new GitHubProviderAdapter(new GitHubOAuthClient(config, http), http) };
}

describe('GitHub capability/resource/verification adapter contract; no platform acceptance', () => {
  it('validates manifest and policy, with R3 write floors and no unverified idempotency promise', () => {
    expect(() => validateProviderCapabilityManifest(githubManifest)).not.toThrow(); expect(() => validateProviderRuntimePolicy(githubPolicy, githubManifest)).not.toThrow();
    expect(githubManifest.capabilities).toHaveLength(5); expect(githubManifest.capabilities.filter((c) => c.operation === 'execute').every((c) => c.riskLevel === 'R3'
      && !c.sideEffectContract.supportsIdempotencyKey && c.sideEffectContract.retrySafety === 'unsafe')).toBe(true);
    const disabled = createConnectorRegistry({ NODE_ENV: 'production' }).get('github'); expect(() => validateConnectorManifest(disabled)).not.toThrow();
    expect(disabled.metadata().productionStatus).toBe('DISABLED'); expect(disabled.capabilities().every((c) => c.providerAvailability === 'disabled')).toBe(true);
  });
  it('publishes four additive generic resources/facts, without adding scenarios or a provider Engine', () => {
    for (const type of ['Repository', 'Issue', 'PullRequest', 'Workflow']) expect(RESOURCE_CATALOG.some((r) => r.key === type)).toBe(true);
    for (const fact of ['repository.metadata', 'issue.state', 'pull_request.state', 'workflow.run_status']) expect(FACT_SCHEMA_CATALOG.some((f) => f.key === fact)).toBe(true);
    const payload = { resourceType: 'PullRequest', resourceId: '99', repositoryId: 42, state: 'closed', merged: true };
    const observation = { sourceMode: 'OFFICIAL_API' as const, providerKey: 'github', connectionId: 'owned-connection', externalEventKey: 'isolated-event',
      parserKey: 'generic.repository-resource.v1' as const, resourceHint: 'PullRequest', payload, evidenceHash: realityValueHash(payload), observedAt: new Date().toISOString() };
    const fact = parseAndNormalizeObservation(observation)[0]; expect(fact).toMatchObject({ factKey: 'pull_request.state', subjectKey: 'owned-connection:42:PullRequest:99' });
    expect(() => parseAndNormalizeObservation({ ...observation, connectionId: undefined })).toThrow();
    expect(parseAndNormalizeObservation({ ...observation, connectionId: 'other-owner' })[0].subjectKey).not.toBe(fact.subjectKey);
  });
  it('does not normalize issue endpoint PRs as Issues and derives list PR merged from actual merged_at', () => {
    expect(() => normalizeGitHubResource({ ...rawIssue, pull_request: {} }, repository, 'Issue')).toThrow();
    expect(normalizeGitHubResource({ ...rawIssue, url: root + '/pulls/1', merged_at: '2026-09-13T10:00:00Z' }, repository, 'PullRequest')).toMatchObject({ merged: true });
    expect(() => normalizeGitHubResource({ ...rawIssue, url: root + '/pulls/1' }, repository, 'PullRequest')).toThrow();
  });
  it('never dispatches a write without structured approved context, scope, account mode or actual repository binding', async () => {
    for (const bad of [ { ...request(), input: {} }, { ...request(), idempotencyKey: undefined },
      { ...request(), credentials: { data: { ...credential, scopes: 'public_repo' } } },
      { ...request(), credentials: { data: { ...credential, tokenMode: 'FINE_GRAINED_PAT' } } },
      request('CREATE_ISSUE', { ...approved, repository: { ...repository, id: 43 } }), request('CREATE_ISSUE', { ...approved, extra: true }) ]) {
      const { adapter, transport } = setup(); await expect(adapter.execute(bad)).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' }); expect(transport).not.toHaveBeenCalled();
    }
  });
  it('does not treat credential-supplied OAuth scope as proof for a different actual user or missing scope header', async () => {
    const { adapter, transport } = setup((url) => url.endsWith('/user') ? json({ id: 999, login: 'other-user' }, 200, { 'x-oauth-scopes': 'repo' }) : undefined);
    await expect(adapter.execute(request())).rejects.toMatchObject({ code: 'AUTH_REVOKED', phase: 'BEFORE_DISPATCH' }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('refuses a moved/renamed/replaced repository before the mutation', async () => {
    const { adapter, transport } = setup((url) => url === root ? json({ ...repository, id: 43, owner: { login: repository.owner }, full_name: repository.owner + '/' + repository.name, private: true }) : undefined);
    await expect(adapter.execute(request())).rejects.toMatchObject({ code: 'PERMISSION_DENIED', phase: 'BEFORE_DISPATCH' }); expect(transport.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('does not silently publish into a repository whose visibility differs from approved context', async () => {
    const { adapter, transport } = setup(); await expect(adapter.execute(request('CREATE_ISSUE', { ...approved, visibility: 'public' }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED', phase: 'BEFORE_DISPATCH' });
    expect(transport.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('creates one issue, reads by returned number and requires complete approved-field/author/marker evidence', async () => {
    const { adapter, transport } = setup(); const result = await adapter.execute(request()); expect(result.data.verificationEvidence).toMatchObject({ matched: true, resourceId: '99' });
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(4);
    for (const changed of [{ body: 'modified' }, { user: { id: 8 } }, { title: 'different title' }, { state: 'closed' }]) {
      const { adapter } = setup((url, init) => url === root + '/issues/1' && init.method !== 'POST' ? json({ ...rawIssue, ...changed }) : undefined);
      expect((await adapter.execute(request())).data.verificationEvidence).toMatchObject({ matched: false });
    }
  });
  it.each([403, 404])('does not use read-back GET %i rejection as proof the preceding POST had no effect', async (status) => {
    const { adapter, transport } = setup((url) => url === root + '/issues/1' ? json({ message: 'denied' }, status) : undefined);
    await expect(adapter.execute(request())).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', phase: 'AFTER_DISPATCH', definitiveNoEffect: false });
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('does not accept a different record ID returned by read-back even with identical fields', async () => {
    const { adapter } = setup((url) => url === root + '/issues/1' ? json({ ...rawIssue, id: 100 }) : undefined);
    await expect(adapter.execute(request())).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });
  it('reconciles only by bounded GET and complete unique evidence; missing/ambiguous results stay unknown', async () => {
    const { adapter, transport } = setup(); expect((await adapter.lookupOperation(request())).data.verificationEvidence).toMatchObject({ matched: true });
    expect(transport.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
    for (const records of [[], [rawIssue, { ...rawIssue, id: 100, number: 2, url: root + '/issues/2' }]]) {
      await expect(setup((url) => url.includes('?') ? json(records) : undefined).adapter.lookupOperation(request())).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', definitiveNoEffect: false });
    }
  });
  it('creates a comment only for the approved Issue/PR kind and reads back the comment ID/issue URL', async () => {
    const fields = { repository, visibility: 'private', issueNumber: 1, targetKind: 'ISSUE', body: 'Approved comment' };
    const expected = prepareGitHubAction(request('CREATE_COMMENT', fields).input, key, true);
    const comment = { id: 101, body: expected.body, user: { id: 7 }, issue_url: root + '/issues/1', url: root + '/issues/comments/101' };
    const { adapter, transport } = setup((url) => url.endsWith('/comments') || url.endsWith('/comments/101') ? json(comment) : undefined);
    expect((await adapter.execute(request('CREATE_COMMENT', fields))).data.verificationEvidence).toMatchObject({ matched: true });
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    const wrongKind = setup((url) => url === root + '/issues/1' ? json({ ...rawIssue, pull_request: {} }) : undefined);
    await expect(wrongKind.adapter.execute(request('CREATE_COMMENT', fields))).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    expect(wrongKind.transport.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('keeps only actual issue records from an issue list and includes verified Repository metadata', async () => {
    const { adapter } = setup((url) => url.includes('?') ? json([rawIssue, { ...rawIssue, pull_request: {} }]) : undefined);
    const result = await adapter.read({ ...request('READ_ISSUE'), input: { repository } });
    expect(result.data.resources).toHaveLength(2);
  });
});
