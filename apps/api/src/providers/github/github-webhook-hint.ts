import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import { githubRepositorySchema } from './github-resource';
import { verifyGitHubWebhookSignature } from './github-webhook-signature';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const gitHubWebhookHintSchema = z.object({
  schema: z.literal('github-refresh-hint.v1'),
  repository: githubRepositorySchema,
  capability: z.enum(['READ_ISSUE', 'READ_PULL_REQUEST', 'READ_WORKFLOW_STATUS']),
  resourceType: z.enum(['Issue', 'PullRequest', 'Workflow']),
  resourceId: id, number: id.optional(), runId: id.optional(),
}).strict().superRefine((hint, ctx) => {
  const workflow = hint.resourceType === 'Workflow';
  const expected = workflow ? 'READ_WORKFLOW_STATUS' : hint.resourceType === 'Issue' ? 'READ_ISSUE' : 'READ_PULL_REQUEST';
  if (hint.capability !== expected || (workflow ? hint.runId !== hint.resourceId || hint.number !== undefined
    : hint.number === undefined || hint.runId !== undefined)) ctx.addIssue({ code: 'custom', message: 'Invalid refresh target' });
});
export type GitHubWebhookHint = z.infer<typeof gitHubWebhookHintSchema>;
const denied = (): never => { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : denied();

// Only identifiers survive. Neither event headers nor signed titles/body/status
// are authoritative facts; the worker must acquire the target through owned REST.
export function parseGitHubWebhookHint(input: { rawBody?: Buffer; signature?: unknown; deliveryId?: unknown; event?: unknown; secret?: string }) {
  const signature = verifyGitHubWebhookSignature(input); // Authenticate original bytes BEFORE decoding/parsing.
  if (input.rawBody!.length > 256 * 1024) return denied();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody!))); }
  catch { return denied(); }
  const rawRepo = object(payload.repository); const owner = object(rawRepo.owner);
  const parsedRepo = githubRepositorySchema.safeParse({ id: rawRepo.id, owner: owner.login, name: rawRepo.name });
  if (!parsedRepo.success || rawRepo.full_name !== `${parsedRepo.data.owner}/${parsedRepo.data.name}`) return denied();
  const repository = parsedRepo.data;
  const variants = ['issue', 'pull_request', 'workflow_run'].filter((key) => payload[key] !== undefined);
  if (variants.length !== 1 || typeof payload.action !== 'string') return denied();
  const resource = object(payload[variants[0]]);
  const root = `https://api.github.com/repos/${repository.owner}/${repository.name}`;
  let hint: unknown;
  if (input.event === 'issues' && variants[0] === 'issue') {
    if (!['opened', 'edited', 'closed', 'reopened', 'assigned', 'unassigned', 'labeled', 'unlabeled', 'locked', 'unlocked', 'milestoned', 'demilestoned', 'pinned', 'unpinned', 'deleted', 'transferred'].includes(payload.action)
      || resource.pull_request !== undefined || resource.url !== `${root}/issues/${resource.number}`) return denied();
    hint = { schema: 'github-refresh-hint.v1', repository, capability: 'READ_ISSUE', resourceType: 'Issue', resourceId: resource.id, number: resource.number };
  } else if (input.event === 'pull_request' && variants[0] === 'pull_request') {
    if (!['opened', 'edited', 'closed', 'reopened', 'synchronize', 'assigned', 'unassigned', 'labeled', 'unlabeled', 'locked', 'unlocked', 'ready_for_review', 'converted_to_draft', 'review_requested', 'review_request_removed', 'auto_merge_enabled', 'auto_merge_disabled', 'enqueued', 'dequeued', 'milestoned', 'demilestoned'].includes(payload.action)
      || payload.number !== resource.number || resource.url !== `${root}/pulls/${resource.number}`) return denied();
    const baseRepo = object(object(resource.base).repo);
    if (baseRepo.id !== repository.id || baseRepo.full_name !== rawRepo.full_name) return denied();
    hint = { schema: 'github-refresh-hint.v1', repository, capability: 'READ_PULL_REQUEST', resourceType: 'PullRequest', resourceId: resource.id, number: resource.number };
  } else if (input.event === 'workflow_run' && variants[0] === 'workflow_run') {
    if (!['requested', 'in_progress', 'completed'].includes(payload.action) || resource.url !== `${root}/actions/runs/${resource.id}`
      || object(resource.repository).id !== repository.id) return denied();
    hint = { schema: 'github-refresh-hint.v1', repository, capability: 'READ_WORKFLOW_STATUS', resourceType: 'Workflow', resourceId: resource.id, runId: resource.id };
  } else return denied();
  const parsed = gitHubWebhookHintSchema.safeParse(hint);
  if (!parsed.success) return denied();
  return { ...signature, hint: parsed.data, payloadSizeBytes: input.rawBody!.length };
}
