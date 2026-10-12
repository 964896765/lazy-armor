import { z } from 'zod';
import { goalBriefRefSchema, goalBriefSchema } from './goal-brief';
import { skillMethodRefsSchema } from './skill-capability';
import { compositionPreviewSchema, skillResourceGraphRequestSchema } from './skill-resource-graph';
import { compositionReadBindingsSchema, compositionResourceSelectionsSchema } from './composition-resources';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceMessages = compositionPreviewSchema.shape.sourceMessageRefs;

/** Reviewed planning input. A client cannot supply permissions, bindings or a Runtime recipe. */
export const compositionAuthoringSelectionSchema = z.object({
  graph: skillResourceGraphRequestSchema,
  basis: z.object({ goalBriefRef: goalBriefRefSchema, methodRefs: skillMethodRefsSchema, sourceMessageRefs: sourceMessages }).strict(),
  resourceSelections: compositionResourceSelectionsSchema.optional(),
}).strict();
export type CompositionAuthoringSelection = z.infer<typeof compositionAuthoringSelectionSchema>;

/** Server-built snapshot persisted in the original authoring job and messages. */
export const compositionAuthoringSnapshotSchema = z.object({
  schemaVersion: z.literal('composition-authoring.v1'),
  kind: z.literal('PLANNING_REFERENCE'), executionAuthorized: z.literal(false), runtimeRecipe: z.literal('NOT_COMPILED'),
  selection: compositionAuthoringSelectionSchema, selectionHash: hash,
  sourceAssistant: z.object({ id: z.uuid(), payloadHash: hash }).strict(),
  sourceGoal: goalBriefSchema,
  orderedMethodIds: z.array(z.uuid()).min(1).max(3),
  riskFloor: compositionPreviewSchema.shape.riskFloor,
  resourcesObservedAt: z.iso.datetime(),
  reportReadBindings: compositionReadBindingsSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  const selected = snapshot.selection.basis.methodRefs.map(ref => ref.entryId);
  if (snapshot.orderedMethodIds.length !== selected.length || new Set(snapshot.orderedMethodIds).size !== selected.length || snapshot.orderedMethodIds.some(id => !selected.includes(id)))
    context.addIssue({ code: 'custom', message: 'Planning order must contain each selected method exactly once' });
  if (snapshot.sourceGoal.goalId !== snapshot.selection.basis.goalBriefRef.goalId || snapshot.sourceGoal.version !== snapshot.selection.basis.goalBriefRef.version)
    context.addIssue({ code: 'custom', message: 'The source requirement must match the reviewed basis' });
  if (snapshot.reportReadBindings?.some(binding => !selected.includes(binding.methodId)))
    context.addIssue({ code: 'custom', message: 'Read bindings must belong to selected methods' });
});
export type CompositionAuthoringSnapshot = z.infer<typeof compositionAuthoringSnapshotSchema>;
