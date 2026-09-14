import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateProviderCapabilityManifest, validateProviderRuntimePolicy, providerDefinitionHash } from '@lazy-armor/connector-sdk';
import { parseGitHubWebhookHint, gitHubWebhookHintSchema } from '../src/providers/github/github-webhook-hint';
import { githubManifest, githubEvidence, githubPolicy } from '../src/providers/github/github-manifest';
import { githubWebhookManifest, githubWebhookEvidence, githubWebhookPolicy } from '../src/providers/github/github-webhook-manifest';

const secret = 'isolated-webhook-secret-at-least-32-characters';
const repository = { id: 42, name: 'repo', full_name: 'owner/repo', owner: { login: 'owner' } };
const issue = { id: 99, number: 1, url: 'https://api.github.com/repos/owner/repo/issues/1', title: 'PRIVATE', body: 'PRIVATE', state: 'closed' };
const payload = { action: 'edited', repository, issue, sender: { login: 'ghost' } };
function delivery(body: unknown = payload, event = 'issues') {
  const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return { rawBody, event, secret, deliveryId: randomUUID(), signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex') };
}
describe('GitHub raw signed refresh-hint contract; no payload-to-Truth shortcut', () => {
  it('keeps only identifiers, not signed titles, body, state, sender or action', () => {
    const parsed = parseGitHubWebhookHint(delivery());
    expect(parsed.hint).toEqual({ schema: 'github-refresh-hint.v1', repository: { id: 42, owner: 'owner', name: 'repo' },
      capability: 'READ_ISSUE', resourceType: 'Issue', resourceId: 99, number: 1 });
    expect(JSON.stringify(parsed.hint)).not.toMatch(/PRIVATE|closed|ghost|edited/);
  });
  it('authenticates whitespace-preserving original bytes, never re-stringified JSON', () => {
    const raw = delivery(Buffer.from(JSON.stringify(payload, null, 2)));
    expect(() => parseGitHubWebhookHint(raw)).not.toThrow();
    expect(() => parseGitHubWebhookHint({ ...raw, rawBody: Buffer.from(JSON.stringify(payload)) })).toThrow();
  });
  it.each([undefined, '', 'short'])('fails closed without usable signing Secret: %s', (value) => {
    expect(() => parseGitHubWebhookHint({ ...delivery(), secret: value })).toThrow();
  });
  it.each(['pull_request', 'workflow_run', 'ping', 'issue_comment', 'unknown'])('does not reinterpret signed issue shape via unsigned header %s', (event) => {
    expect(() => parseGitHubWebhookHint(delivery(payload, event))).toThrow();
  });
  it('rejects ambiguous event kinds and issue endpoint PRs', () => {
    expect(() => parseGitHubWebhookHint(delivery({ ...payload, pull_request: {} }))).toThrow();
    expect(() => parseGitHubWebhookHint(delivery({ ...payload, issue: { ...issue, pull_request: {} } }))).toThrow();
  });
  it('rejects invalid UTF8, malformed JSON, array roots, unsafe IDs and over-budget bodies', () => {
    for (const body of [Buffer.from([0xff]), Buffer.from('{'), [], { ...payload, issue: { ...issue, id: Number.MAX_SAFE_INTEGER + 1 } },
      Buffer.from(JSON.stringify({ ...payload, extra: 'a'.repeat(262144) }))]) expect(() => parseGitHubWebhookHint(delivery(body))).toThrow();
  });
  it('binds repository canonical identity, resource URL and PR base repo, not fork head or sender', () => {
    expect(() => parseGitHubWebhookHint(delivery({ ...payload, repository: { ...repository, full_name: 'foreign/repo' } }))).toThrow();
    expect(() => parseGitHubWebhookHint(delivery({ ...payload, issue: { ...issue, url: issue.url.replace('owner', 'foreign') } }))).toThrow();
    const pull_request = { ...issue, url: issue.url.replace('issues', 'pulls'), base: { repo: repository }, head: { repo: { id: 1000 } } };
    const pr = { action: 'closed', repository, number: 1, pull_request };
    expect(parseGitHubWebhookHint(delivery(pr, 'pull_request')).hint.resourceType).toBe('PullRequest');
    expect(() => parseGitHubWebhookHint(delivery({ ...pr, pull_request: { ...pull_request, base: { repo: { ...repository, id: 1000 } } } }, 'pull_request'))).toThrow();
    expect(() => parseGitHubWebhookHint(delivery({ ...pr, number: 2 }, 'pull_request'))).toThrow();
  });
  it('binds workflow run repository and ID and keeps all statuses non-authoritative', () => {
    const workflow_run = { id: 3, url: 'https://api.github.com/repos/owner/repo/actions/runs/3', repository, status: 'completed' };
    const workflow = { action: 'completed', repository, workflow_run };
    expect(parseGitHubWebhookHint(delivery(workflow, 'workflow_run')).hint).toMatchObject({ capability: 'READ_WORKFLOW_STATUS', runId: 3, resourceId: 3 });
    expect(() => parseGitHubWebhookHint(delivery({ ...workflow, workflow_run: { ...workflow_run, repository: { id: 1000 } } }, 'workflow_run'))).toThrow();
  });
  it('keeps replay hash invariant when unsigned delivery identity changes', () => {
    const first = delivery(); const a = parseGitHubWebhookHint(first); const b = parseGitHubWebhookHint({ ...first, deliveryId: randomUUID() });
    expect(a.payloadHash).toBe(b.payloadHash); expect(a.deliveryId).not.toBe(b.deliveryId);
  });
  it('rejects capability-kind/number mismatches even in persisted minimal hints', () => {
    const hint = parseGitHubWebhookHint(delivery()).hint;
    for (const bad of [{ ...hint, capability: 'CREATE_ISSUE' }, { ...hint, runId: 3 }, { ...hint, number: undefined }, { ...hint, resourceType: 'Workflow' }]) expect(gitHubWebhookHintSchema.safeParse(bad).success).toBe(false);
  });
  it('adds immutable manifest/evidence/policy revisions without broadening write capabilities', () => {
    const hashes = [githubManifest, githubEvidence, githubPolicy].map(providerDefinitionHash);
    expect(() => validateProviderCapabilityManifest(githubWebhookManifest)).not.toThrow();
    expect(() => validateProviderRuntimePolicy(githubWebhookPolicy, githubWebhookManifest)).not.toThrow();
    expect(githubWebhookManifest.revision).toBe(3); expect(githubWebhookPolicy.manifestRevision).toBe(3); expect(githubWebhookEvidence.revision).toBe(2);
    expect(githubWebhookManifest.capabilities.filter((c) => c.operation === 'execute')).toEqual(githubManifest.capabilities.filter((c) => c.operation === 'execute').map((c) => ({ ...c, evidence: githubWebhookManifest.capabilities.find((n) => n.key === c.key)!.evidence })));
    expect([githubManifest, githubEvidence, githubPolicy].map(providerDefinitionHash)).toEqual(hashes);
  });
});
