import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const githubRepositorySchema = z.object({ id: identifier, owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine((v) => v !== '.' && v !== '..') }).strict();
const approved = z.object({ repository: githubRepositorySchema, visibility: z.enum(['private', 'public']), title: z.string().min(1).max(256).optional(),
  body: z.string().max(60000), issueNumber: identifier.optional(), targetKind: z.enum(['ISSUE', 'PULL_REQUEST']).optional() }).strict();
export type GitHubRepository = z.infer<typeof githubRepositorySchema>;
export function prepareGitHubAction(input: Record<string, unknown>, key: string | undefined, comment: boolean) {
  const parsed = approved.safeParse((input.context as Record<string, unknown> | undefined)?.githubAction);
  if (!parsed.success || !/^[a-f0-9]{64}$/.test(key ?? '')) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const data = parsed.data;
  if ((comment && (!data.issueNumber || !data.targetKind || data.title !== undefined))
    || (!comment && (!data.title || data.issueNumber !== undefined || data.targetKind !== undefined))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  const body = data.body.replace(/\r\n?/g, '\n');
  // Reserve our own marker namespace; never accept a user-supplied operation marker.
  if (Buffer.byteLength(body) > 60 * 1024 || /lazy-armor-operation:/i.test(body)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...data, body: body + `\n\n<!-- lazy-armor-operation:${key} -->`, operationKey: key! };
}
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const failed = (): never => { throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH'); };
export function normalizeGitHubRepository(raw: Record<string, unknown>, expected?: GitHubRepository) {
  const owner = raw.owner as Record<string, unknown> | undefined;
  const parsed = githubRepositorySchema.safeParse({ id: raw.id, name: raw.name, owner: owner?.login });
  if (!parsed.success) return failed();
  if (typeof raw.private !== 'boolean' || raw.full_name !== `${parsed.data.owner}/${parsed.data.name}`) return failed();
  const actual = parsed.data;
  if (expected && (expected.id !== actual.id || expected.owner.toLowerCase() !== actual.owner.toLowerCase()
    || expected.name.toLowerCase() !== actual.name.toLowerCase())) throw new ProviderRuntimeError('PERMISSION_DENIED', 'AFTER_DISPATCH');
  return { resourceType: 'Repository' as const, resourceId: String(actual.id), repositoryId: actual.id, owner: actual.owner, name: actual.name, private: raw.private as boolean };
}
export function normalizeGitHubResource(raw: Record<string, unknown>, repository: GitHubRepository, kind: 'Issue' | 'PullRequest' | 'Workflow') {
  if (!positive(raw.id) || typeof raw.updated_at !== 'string' || !Number.isFinite(Date.parse(raw.updated_at))) failed();
  const common = { resourceType: kind, resourceId: String(raw.id), repositoryId: repository.id, updatedAt: new Date(raw.updated_at as string).toISOString() };
  if (kind === 'Workflow') {
    if (!positive(raw.workflow_id) || !['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(String(raw.status))
      || (raw.conclusion !== null && typeof raw.conclusion !== 'string') || typeof raw.head_sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(raw.head_sha)) failed();
    return { ...common, workflowId: raw.workflow_id as number, status: raw.status as string, conclusion: raw.conclusion as string | null, headSha: raw.head_sha as string };
  }
  const author = raw.user as Record<string, unknown> | undefined;
  if (!positive(raw.number) || typeof raw.title !== 'string' || raw.title.length > 1024 || !['open', 'closed'].includes(String(raw.state))
    || !positive(author?.id) || (raw.body !== null && typeof raw.body !== 'string') || Buffer.byteLength(String(raw.body ?? '')) > 128 * 1024
    || (kind === 'Issue' && raw.pull_request !== undefined) || (kind === 'PullRequest' && typeof raw.merged !== 'boolean'
      && raw.merged_at !== null && !(typeof raw.merged_at === 'string' && Number.isFinite(Date.parse(raw.merged_at))))) failed();
  const url = `https://api.github.com/repos/${repository.owner}/${repository.name}/${kind === 'Issue' ? 'issues' : 'pulls'}/${raw.number}`;
  if (raw.url !== url) throw new ProviderRuntimeError('PERMISSION_DENIED', 'AFTER_DISPATCH');
  return { ...common, number: raw.number as number, title: raw.title as string, body: String(raw.body ?? ''), state: raw.state as string,
    authorId: author!.id as number, ...(kind === 'PullRequest' ? { merged: typeof raw.merged === 'boolean' ? raw.merged : raw.merged_at !== null } : {}) };
}
export function gitHubWriteEvidence(raw: Record<string, unknown>, desired: ReturnType<typeof prepareGitHubAction>, authorId: string, comment: boolean) {
  const author = raw.user as Record<string, unknown> | undefined;
  const path = `https://api.github.com/repos/${desired.repository.owner}/${desired.repository.name}/issues`;
  const expected = { repositoryId: desired.repository.id, authorId, body: desired.body, ...(comment ? { issueNumber: desired.issueNumber } : { title: desired.title }) };
  const actual = { repositoryId: desired.repository.id, authorId: String(author?.id), body: raw.body,
    ...(comment ? { issueNumber: raw.issue_url === path + '/' + desired.issueNumber ? desired.issueNumber : null } : { title: raw.title }) };
  const matched = positive(raw.id) && positive(author?.id) && (comment ? raw.url === path + '/comments/' + raw.id
    : positive(raw.number) && raw.url === path + '/' + raw.number && raw.pull_request === undefined && raw.state === 'open')
    && providerDefinitionHash(actual) === providerDefinitionHash(expected);
  return { matched, resourceId: positive(raw.id) ? String(raw.id) : '', repositoryId: desired.repository.id,
    expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(actual) };
}
