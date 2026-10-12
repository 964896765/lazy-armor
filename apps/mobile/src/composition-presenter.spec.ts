import { describe, expect, it } from 'vitest';
import { compositionOptionsSchema } from '@lazy-armor/plan-schema/mobile';
import { reportResourceSelections, bindCompositionInput, compositionIssueLabel, compositionSources } from './composition-presenter';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const ref = (id: string) => ({ repositoryId: a, repositoryVersion: 1, entryId: id, revisionId: id, contentHash: 'a'.repeat(64) });
const options = compositionOptionsSchema.parse({ conversationId: a, conversationVersion: 2, executionAuthorized: false, goal: null, suggested: null, methods: [
  { ref: ref(a), name: 'Research', input: { fields: {}, required: [] }, output: { fields: { count: 'integer', body: 'string' }, required: [] } },
  { ref: ref(b), name: 'Report', input: { fields: { count: 'number', exact: 'integer' }, required: ['count'] }, output: { fields: { report: 'string' }, required: [] } },
] });
describe('composition review sources', () => {
  it('offers compatible upstream ports only, allowing integer to number without narrowing', () => {
    expect(compositionSources(options, b, 'count')).toHaveLength(1);
    const narrowing = { ...options, methods: [{ ...options.methods[0], output: { fields: { count: 'number' as const }, required: [] } }, options.methods[1]] };
    expect(compositionSources(narrowing, b, 'exact')).toEqual([]);
    expect(compositionSources(options, a, 'count')).toEqual([]);
    expect(compositionSources(options, 'unknown', 'count')).toEqual([]);
  });
  it('replaces an existing source instead of creating competing inputs and clears a deselection', () => {
    const request = { version: 2, links: [], goalBindings: [{ methodId: b, inputField: 'count', goalField: 'budget' as const }], deliveries: [{ methodId: b, outputField: 'report', label: '报告' }] };
    const selected = bindCompositionInput(request, b, 'count', { kind: 'OUTPUT', methodId: a, field: 'count', label: 'Count' });
    expect(selected.goalBindings).toEqual([]); expect(selected.links).toHaveLength(1); expect(request.goalBindings).toHaveLength(1);
    expect(bindCompositionInput(selected, b, 'count', null).links).toEqual([]);
  });
  it('rejects authority-granting option payloads and renders unsupported issues as a review need', () => {
    expect(compositionOptionsSchema.safeParse({ ...options, executionAuthorized: true }).success).toBe(false);
    expect(compositionIssueLabel('SIDE_EFFECT_RECIPE_REQUIRED')).toContain('另行准备执行方案');
    expect(compositionIssueLabel('NEW_UNKNOWN_ISSUE')).toContain('仍需核对');
  });
});


describe('report source selections', () => {
  const methodId = '11111111-1111-4111-8111-111111111111', a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
  const options = { conversationId: methodId, conversationVersion: 1, executionAuthorized: false as const, requirements: [{ methodId, capabilityKey: 'READ_PUBLIC_WEB_RESEARCH' as const, candidates: [{ connectionId: a, name: '来源A' }, { connectionId: b, name: '来源B' }] }] };
  it('keeps multiple sources unselected and accepts only an explicit current choice', () => {
    expect(reportResourceSelections(options, {})).toBeNull();
    expect(reportResourceSelections(options, { [`${methodId}:READ_PUBLIC_WEB_RESEARCH`]: b })).toEqual([{ methodId, capabilityKey: 'READ_PUBLIC_WEB_RESEARCH', connectionId: b }]);
  });
  it('uses a visible unique candidate and refuses a stale choice without silently replacing it', () => {
    const single = { ...options, requirements: [{ ...options.requirements[0], candidates: [options.requirements[0].candidates[0]] }] };
    expect(reportResourceSelections(single, {})).toEqual([{ methodId, capabilityKey: 'READ_PUBLIC_WEB_RESEARCH', connectionId: a }]);
    expect(reportResourceSelections(single, { [`${methodId}:READ_PUBLIC_WEB_RESEARCH`]: b })).toBeNull();
  });
});
