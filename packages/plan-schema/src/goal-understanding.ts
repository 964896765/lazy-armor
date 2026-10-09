import { z } from 'zod';

/** Read-only explanation of a validated proposal. Never an execution authority. */
export const goalUnderstandingSchema = z.object({
  schemaVersion: z.literal('goal-understanding.v1'),
  proposalId: z.string().min(1),
  stage: z.literal('AI_PROPOSED'),
  summary: z.string().min(1),
  domain: z.string().nullable(),
  lifecycle: z.enum(['TEMPORARY', 'USER_EVENT', 'PERSISTENT']).nullable(),
  executionMode: z.enum(['DIRECT', 'COMPOSED']).nullable(),
  requiredFacts: z.array(z.string()),
  capabilities: z.array(z.object({
    key: z.string().min(1),
    availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'UNRESOLVED']),
    reasons: z.array(z.string()),
    sourcePackage: z.string().optional(),
  }).strict()),
  steps: z.array(z.enum(['CONFIRM', 'SAVE_EVENT', 'ACQUIRE', 'ASSESS', 'EXECUTE', 'VERIFY', 'WAIT'])),
  missingRequirements: z.array(z.string()),
  selectedSkillIds: z.array(z.string()),
  truthRefs: z.array(z.object({ truthId: z.string(), versionId: z.string().nullable() }).strict()),
  policy: z.object({
    confirmationRequired: z.boolean(),
    approval: z.enum(['RUNTIME_POLICY', 'NOT_APPLICABLE']),
    executionAuthorized: z.literal(false),
  }).strict(),
  provenance: z.object({ modelId: z.string().min(1), generatedAt: z.iso.datetime(), timezone: z.string().optional(), locale: z.string().optional() }).strict(),
}).strict();

export type GoalUnderstanding = z.infer<typeof goalUnderstandingSchema>;
