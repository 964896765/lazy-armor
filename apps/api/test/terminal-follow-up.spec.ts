import { describe, expect, it } from 'vitest';
import { compileScenarioPlan, evaluateConditionAst, SCENARIO_DEFINITIONS, STRATEGY_PROFILES,
  terminalFollowUpRule, buildTerminalFollowUpRuntime } from '@lazy-armor/plan-schema';
const subject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:742:PullRequest:800';
describe('registered deterministic terminal follow-up revisions', () => {
  it('preserves the canonical 96 scenarios and 8 profiles at revision 1', () => {
    expect(SCENARIO_DEFINITIONS).toHaveLength(96); expect(STRATEGY_PROFILES).toHaveLength(8);
    expect(SCENARIO_DEFINITIONS.every((s) => s.revision === 1)).toBe(true);
    expect(STRATEGY_PROFILES.find((s) => s.key === 'SILENT_FOLLOW_UP')?.defaultActionMode).toBe('OBSERVE');
    expect(compileScenarioPlan({ scenarioKey: 'work.tasks' }).scenarioRevision).toBe(1);
  });
  it('compiles an exact-subject new revision into existing notification and record actions', () => {
    const plan = compileScenarioPlan({ scenarioKey: 'work.tasks', scenarioRevision: 2, subjectKey: subject });
    expect(plan.runtime.dependencies).toEqual([{ factKey: 'pull_request.state', resourceType: 'PullRequest', field: 'merged', scope: 'EXACT_SUBJECT', subjectKey: subject }]);
    expect(plan.definition.actions.map((a) => a.actionType)).toEqual(['notify', 'record']);
    expect(plan.definition.conditions[0]).toMatchObject({ fieldPath: 'pull_request.state.merged', operator: 'EQ', comparisonValue: true });
    expect(compileScenarioPlan({ scenarioKey: 'work.tasks', scenarioRevision: 2, subjectKey: subject }).runtime.runtimeHash).toBe(plan.runtime.runtimeHash);
  });
  it.each([undefined, 'arbitrary', subject.replace('PullRequest', 'Issue')])('rejects missing/wrong target %s', (subjectKey) => {
    expect(() => compileScenarioPlan({ scenarioKey: 'work.tasks', scenarioRevision: 2, subjectKey })).toThrow();
  });
  it.each([3, 999])('rejects unregistered revision %s', (scenarioRevision) => {
    expect(() => compileScenarioPlan({ scenarioKey: 'work.tasks', scenarioRevision, subjectKey: subject })).toThrow();
  });
  it.each([[false, false, false], [true, true, false], [undefined, true, false], [false, true, true], [true, false, false]])(
    'PR transition %s -> %s is terminal=%s', (previousValue, value, expected) => {
      const runtime = buildTerminalFollowUpRuntime(terminalFollowUpRule('work.tasks', 2)!, subject);
      expect(evaluateConditionAst(runtime.conditionAst, { evaluatedAt: '2026-09-14T00:00:00Z', facts: {
        'pull_request.state': { value, previousValue, truthVersionId: 'version', verifiedAt: '2026-09-14T00:00:00Z' },
      } }).result).toBe(expected);
    });
  it('only follows a Workflow status transition to completed, not a conclusion/update change', () => {
    const runtime = buildTerminalFollowUpRuntime(terminalFollowUpRule('work.recurring_work', 2)!, subject.replace('PullRequest:800', 'Workflow:803'));
    for (const [previousValue, value, expected] of [['queued', 'in_progress', false], ['in_progress', 'completed', true], ['completed', 'completed', false]] as const) {
      expect(evaluateConditionAst(runtime.conditionAst, { evaluatedAt: '2026-09-14T00:00:00Z', facts: {
        'workflow.run_status': { value, previousValue, truthVersionId: 'version', verifiedAt: '2026-09-14T00:00:00Z' },
      } }).result).toBe(expected);
    }
  });
});
