import { z } from 'zod';
import { skillMethodRefSchema } from './skill-capability';

/** A server compiler's draft result, never an execution or permission grant. */
export const compositionRuntimeCompilationSchema = z.object({
  schemaVersion: z.literal('composition-runtime.v1'), state: z.literal('COMPILED_DRAFT'), executionAuthorized: z.literal(false),
  adapter: z.literal('INTERNAL_DAILY_SUMMARY_V1'), recipeKey: z.literal('daily_life.errands.summary'), recipeRevision: z.literal(2),
  selectionHash: z.string().regex(/^[a-f0-9]{64}$/), goalHash: z.string().regex(/^[a-f0-9]{64}$/),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/), compilationHash: z.string().regex(/^[a-f0-9]{64}$/),
  methods: z.array(z.object({ ref: skillMethodRefSchema, stepOrder: z.number().int().min(0).max(1),
    inputs: z.array(z.object({ field: z.literal('humanSummary'), fromStepOrder: z.literal(0), outputField: z.literal('humanSummary') }).strict()).max(1),
    outputs: z.array(z.enum(['humanSummary', 'notified'])).length(1),
  }).strict()).length(2),
  sourceScope: z.literal('OWNER_INTERNAL_TASK_CANDIDATES'), schedule: z.literal('09:00 Asia/Shanghai'),
  verification: z.literal('ORIGINAL_EXECUTION_RECORDS'),
}).strict();
export type CompositionRuntimeCompilation = z.infer<typeof compositionRuntimeCompilationSchema>;
