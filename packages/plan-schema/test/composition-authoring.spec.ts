import { describe, expect, it } from 'vitest';
import { compositionAuthoringSelectionSchema, compositionAuthoringSnapshotSchema } from '../src/composition-authoring';
import { goalBriefSchema } from '../src/goal-brief';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const ref = (id: string) => ({ repositoryId: a, repositoryVersion: 1, entryId: id, revisionId: id, contentHash: 'a'.repeat(64) });
const goal = goalBriefSchema.parse({ schemaVersion: 'goal-brief.v1', goalId: a, version: 2, statement: '整理学习计划', domain: null, lifecycle: null,
  outcomeKind: 'UNSPECIFIED', fields: [{ key: 'goal', value: '整理学习计划', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: b, quote: '整理学习计划' }] }],
  readiness: { state: 'READY_FOR_PROPOSAL', reasonCodes: [], questions: [], executionAuthorized: false }, createdAt: '2026-10-12T00:00:00.000Z', executionAuthorized: false });
const selection = { graph: { version: 5, links: [], goalBindings: [], deliveries: [{ methodId: b, outputField: 'report', label: '学习计划' }] },
  basis: { goalBriefRef: { goalId: a, version: 2, contentHash: 'b'.repeat(64) }, methodRefs: [ref(a), ref(b)], sourceMessageRefs: [{ id: b, contentHash: 'c'.repeat(64) }] } };
const snapshot = { schemaVersion: 'composition-authoring.v1', kind: 'PLANNING_REFERENCE', executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED',
  selection, selectionHash: 'd'.repeat(64), sourceAssistant: { id: a, payloadHash: 'e'.repeat(64) }, sourceGoal: goal, orderedMethodIds: [a, b], riskFloor: 'R0', resourcesObservedAt: '2026-10-12T01:00:00.000Z' };
describe('composition planning handoff contract', () => {
  it('accepts separate requirement and conversation version sequences without inventing execution authority', () => {
    expect(compositionAuthoringSnapshotSchema.parse(snapshot)).toMatchObject({ kind: 'PLANNING_REFERENCE', executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED' });
  });
  it('refuses client permissions, fabricated Runtime recipes and injection through graph fields', () => {
    expect(compositionAuthoringSelectionSchema.safeParse({ ...selection, permissions: ['WRITE'] }).success).toBe(false);
    expect(compositionAuthoringSnapshotSchema.safeParse({ ...snapshot, executionAuthorized: true }).success).toBe(false);
    expect(compositionAuthoringSnapshotSchema.safeParse({ ...snapshot, runtimeRecipe: 'COMPILED' }).success).toBe(false);
    expect(compositionAuthoringSelectionSchema.safeParse({ ...selection, graph: { ...selection.graph, bindings: ['tool'] } }).success).toBe(false);
  });
  it('rejects duplicate, missing or foreign methods in the planning order', () => {
    for (const order of [[a, a], [a], [a, '33333333-3333-4333-8333-333333333333']])
      expect(compositionAuthoringSnapshotSchema.safeParse({ ...snapshot, orderedMethodIds: order }).success).toBe(false);
  });
  it('rejects requirements belonging to another goal or revision', () => {
    for (const sourceGoal of [{ ...goal, goalId: b }, { ...goal, version: 3 }])
      expect(compositionAuthoringSnapshotSchema.safeParse({ ...snapshot, sourceGoal }).success).toBe(false);
  });
});
