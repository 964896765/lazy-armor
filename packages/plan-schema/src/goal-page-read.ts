import { z } from 'zod';

/** A semantic read requirement. Selectors and execution authority are server-owned. */
export const goalPageReadSchema = z.object({
  version: z.literal('goal-page-read.v1'),
  packageName: z.literal('com.miui.calculator'),
  fields: z.tuple([z.literal('currentResult')]),
}).strict();
export type GoalPageRead = z.infer<typeof goalPageReadSchema>;

export const frozenGoalPageReadSchema = z.object({
  conversationId: z.uuid(), messageId: z.uuid(), conversationVersion: z.number().int().nonnegative(),
  proposalId: z.string().min(1), proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type FrozenGoalPageRead = z.infer<typeof frozenGoalPageReadSchema>;

/** Derived result card attached to the original conversation; never a new Task authority. */
export interface GoalPageReadResult {
  sessionId: string; messageId: string; conversationVersion: number; deviceTaskId: string | null;
  status: 'CONFIRMED' | 'READING' | 'NEEDS_CONFIRMATION' | 'VERIFIED' | 'REJECTED' | 'FAILED' | 'SOURCE_UNAVAILABLE' | 'SUPERSEDED';
  candidates: Array<{ id: string; status: string }>;
  verified: Array<{ truthId: string; versionId: string; value: string; observedAt: string }>;
}
