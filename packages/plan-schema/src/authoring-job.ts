import { z } from 'zod';

/** Authoring produces a checked suggestion or document, never execution authority. */
export const AUTHORING_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SUPERSEDED'] as const;
export const authoringJobProjectionSchema = z.object({
  schemaVersion: z.literal('authoring-job.v1'),
  jobId: z.string().uuid(), conversationId: z.string().uuid(), requestId: z.string().min(1).max(100),
  status: z.enum(AUTHORING_JOB_STATUSES),
  stage: z.enum(['QUEUED', 'UNDERSTANDING', 'COMPILING', 'COMPLETED', 'STOPPED']),
  attemptCount: z.number().int().nonnegative(), maxAttempts: z.number().int().min(1).max(2),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), deadlineAt: z.iso.datetime(),
  resultMessageId: z.string().uuid().nullable(), errorCode: z.string().max(100).nullable(),
  executionAuthorized: z.literal(false),
}).strict();
export type AuthoringJobProjection = z.infer<typeof authoringJobProjectionSchema>;
export function authoringJobTerminal(status: AuthoringJobProjection['status']) {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(status);
}
