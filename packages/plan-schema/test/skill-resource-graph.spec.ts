import { describe, expect, it } from 'vitest';
import { compileSkillResourceGraph, skillResourceGraphRequestSchema, suggestSkillResourceGraph } from '../src/skill-resource-graph';
import { goalBriefSchema } from '../src/goal-brief';
import type { SkillCapability, SkillMethodRef } from '../src/skill-capability';
import type { MethodResourceMatch } from '../src/goal-resource-match';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const contract = (fields: Record<string, string>, required = Object.keys(fields)) => ({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type }])), required });
const ref = (entryId: string): SkillMethodRef => ({ repositoryId: a, repositoryVersion: 2, entryId, revisionId: entryId, contentHash: 'a'.repeat(64) });
const manifest = (name: string, input: Record<string, string>, output: Record<string, string>): SkillCapability => ({ name, version: '1.0.0', description: name, domain: 'business',
  input: contract(input), output: contract(output), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '仅声明方法，不授权执行。' });
const methods = [{ ref: ref(a), manifest: manifest('ResearchMethod', { goal: 'string' }, { research: 'string' }) },
  { ref: ref(b), manifest: manifest('ReportMethod', { research: 'string' }, { report: 'string' }) }];
const goal = goalBriefSchema.parse({ schemaVersion: 'goal-brief.v1', goalId: a, version: 3, statement: '评估洗车店', domain: null, lifecycle: null,
  outcomeKind: 'REPORT', fields: [{ key: 'goal', value: '评估洗车店', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'user-message', quote: '评估洗车店' }] }],
  readiness: { state: 'READY_FOR_PROPOSAL', reasonCodes: [], questions: [], executionAuthorized: false }, createdAt: '2026-10-12T00:00:00.000Z', executionAuthorized: false });
const resources: MethodResourceMatch = { schemaVersion: 'method-resource-match.v1', conversationId: a, conversationVersion: 4, workContext: 'TEMPORARY',
  evaluatedAt: '2026-10-12T01:00:00.000Z', executionAuthorized: false, methods: methods.map(method => ({ ref: method.ref, name: method.manifest.name, version: '1.0.0', repositoryName: 'Owned fixture', declaredRisk: 'R0', requirements: [] })) };
const request = { version: 4, links: [{ fromMethodId: a, outputField: 'research', toMethodId: b, inputField: 'research' }],
  goalBindings: [{ methodId: a, inputField: 'goal', goalField: 'goal' }], deliveries: [{ methodId: b, outputField: 'report', label: '评估报告' }] };
const compile = (raw: unknown = request, selected = methods, matched = resources) => compileSkillResourceGraph(raw, selected, goal, matched);
describe('V93 bounded method resource graph structure', () => {
  it('suggests only unique compatible named ports, without guessing opaque field meanings', () => {
    expect(suggestSkillResourceGraph(4, methods, goal)).toMatchObject({ links: request.links, goalBindings: request.goalBindings });
    const opaque = [{ ...methods[0], manifest: { ...methods[0].manifest, input: contract({ arbitrary: 'string' }) } }, methods[1]];
    expect(suggestSkillResourceGraph(4, opaque, goal)?.goalBindings).toEqual([]);
    const duplicate = { ref: ref('33333333-3333-4333-8333-333333333333'), manifest: manifest('OtherResearch', {}, { research: 'string' }) };
    expect(suggestSkillResourceGraph(4, [methods[0], duplicate, methods[1]], goal)?.links).toEqual([]);
  });
  it('confirmed historical inputs require a withdrawal-aware adapter and are never guessed', () => {
    const confirmed = { ...goal, fields: [...goal.fields, { key: 'budget' as const, value: '500元', status: 'CONFIRMED' as const, sourceRefs: [{ kind: 'CONFIRMED_MEMORY' as const, id: a, version: 1, quote: '500元' }] }] };
    const changed = [{ ...methods[0], manifest: { ...methods[0].manifest, input: contract({ goal: 'string', budget: 'string' }) } }, methods[1]];
    const graph = compileSkillResourceGraph({ ...request, goalBindings: [...request.goalBindings, { methodId: a, inputField: 'budget', goalField: 'budget' }] }, changed, confirmed, resources);
    expect(graph.issues.map(issue => issue.code)).toContain('CONFIRMED_GOAL_SOURCE_ADAPTER_REQUIRED');
    expect(suggestSkillResourceGraph(4, changed, confirmed)?.goalBindings).toHaveLength(1);
  });
  it('orders a typed chain, preserves separate goal/conversation versions and never grants execution', () => {
    const result = compile(); expect(result).toMatchObject({ state: 'STRUCTURE_VALID', orderedMethodIds: [a, b], goalRef: { goalId: a, version: 3 }, readOnly: true, executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED' });
    expect(result.nodes.filter(node => node.kind === 'OUTPUT')).toHaveLength(1);
  });
  it('rejects cycles and multiple sources bound to one input', () => {
    const result = compile({ ...request, links: [...request.links, { fromMethodId: b, outputField: 'report', toMethodId: a, inputField: 'goal' }] });
    expect(result.state).toBe('BLOCKED'); expect(result.issues.map(issue => issue.code)).toContain('METHOD_CYCLE'); expect(result.issues.map(issue => issue.code)).toContain('DUPLICATE_INPUT_BINDING');
  });
  it('requires every required input and actual source/output fields', () => {
    expect(compile({ ...request, goalBindings: [] }).issues.map(issue => issue.code)).toContain('REQUIRED_INPUT_MISSING');
    expect(compile({ ...request, links: [{ ...request.links[0], outputField: 'imaginary' }] }).issues.map(issue => issue.code)).toContain('MAPPING_FIELD_MISSING');
    expect(compile({ ...request, deliveries: [{ ...request.deliveries[0], outputField: 'imaginary' }] }).issues.map(issue => issue.code)).toContain('DELIVERY_FIELD_MISSING');
  });
  it('blocks missing goal data and numeric casts of unparsed user statements', () => {
    const numeric = methods.map(method => ({ ...method, manifest: { ...method.manifest } })); numeric[0].manifest.input = contract({ goal: 'number' });
    expect(compile(request, numeric).issues.map(issue => issue.code)).toContain('GOAL_MAPPING_TYPE_MISMATCH');
    expect(compile({ ...request, goalBindings: [{ ...request.goalBindings[0], goalField: 'budget' }] }).issues.map(issue => issue.code)).toContain('GOAL_FIELD_UNAVAILABLE');
  });
  it('checks exact field types, permitting integer to number only', () => {
    const numeric = methods.map(method => ({ ...method, manifest: { ...method.manifest } })); numeric[0].manifest.output = contract({ research: 'integer' }); numeric[1].manifest.input = contract({ research: 'number' });
    expect(compile(request, numeric).state).toBe('STRUCTURE_VALID'); numeric[0].manifest.output = contract({ research: 'number' }); numeric[1].manifest.input = contract({ research: 'integer' });
    expect(compile(request, numeric).issues.map(issue => issue.code)).toContain('MAPPING_TYPE_MISMATCH');
  });
  it('legacy open contracts and unsupported JSON Schema keywords fail closed without evaluating code', () => {
    for (const input of [{ type: 'object' }, { ...contract({ goal: 'string' }), $ref: 'https://untrusted.example/schema' }, { ...contract({ goal: 'string' }), additionalProperties: true }]) {
      const changed = [{ ...methods[0], manifest: { ...methods[0].manifest, input } }, methods[1]];
      expect(compile(request, changed).issues.map(issue => issue.code)).toContain('INPUT_CONTRACT_UNSUPPORTED');
    }
  });
  it('retains the existing three method limit, bounded links, safe field names and unique outputs', () => {
    expect(() => compile(request, [...methods, { ...methods[0], ref: ref('33333333-3333-4333-8333-333333333333') }, { ...methods[0], ref: ref('44444444-4444-4444-8444-444444444444') }])).toThrow();
    expect(skillResourceGraphRequestSchema.safeParse({ ...request, links: Array(33).fill(request.links[0]) }).success).toBe(false);
    expect(skillResourceGraphRequestSchema.safeParse({ ...request, deliveries: [{ ...request.deliveries[0], outputField: 'constructor' }] }).success).toBe(false);
    expect(compile({ ...request, deliveries: [request.deliveries[0], request.deliveries[0]] }).issues.map(issue => issue.code)).toContain('DUPLICATE_DELIVERY');
  });
  it('missing resources and changed version identities cannot become observed ready', () => {
    const selected = [{ ...methods[0], manifest: { ...methods[0].manifest, requiredCapabilities: ['document.read'] } }, methods[1]];
    expect(compile(request, selected).issues.map(issue => issue.code)).toContain('RESOURCE_GAP');
    const changed = { ...resources, methods: resources.methods.map(method => ({ ...method, ref: { ...method.ref, repositoryVersion: 3 } })) };
    expect(compile(request, selected, changed).issues.map(issue => issue.code)).toContain('METHOD_RESOURCE_REFERENCE_MISMATCH');
  });
  it('actual resource risk dominates declared R0; write declarations still require an original recipe', () => {
    const selected = [{ ...methods[0], manifest: { ...methods[0].manifest, requiredCapabilities: ['document.read'] } }, methods[1]];
    const matched: MethodResourceMatch = { ...resources, methods: [{ ...resources.methods[0], requirements: [{ key: 'document.read', reasons: [], resources: [{ resourceId: 'fixture', name: 'Owned', state: 'READY', reasons: [], operation: 'read', riskLevel: 'R3', action: { label: 'Review', path: '/' } }] }] }, resources.methods[1]] };
    expect(compile(request, selected, matched).riskFloor).toBe('R3'); selected[0].manifest.permission = ['WRITE'];
    expect(compile(request, selected, matched).issues.map(issue => issue.code)).toContain('SIDE_EFFECT_RECIPE_REQUIRED');
    const withoutRisk = structuredClone(matched); delete withoutRisk.methods[0].requirements[0].resources[0].riskLevel;
    expect(compile(request, selected, withoutRisk).riskFloor).toBe('R4');
  });
});
