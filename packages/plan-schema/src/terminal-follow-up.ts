import { createHash } from 'node:crypto';
import { canonicalStringify } from './index';
import { scenarioByKey, type ScenarioDefinition } from './runtime-catalog';
import { buildStrategyRuntime, type CompiledStrategyRuntime } from './strategy-runtime';

// New scenario revisions, not replacements for the 96 canonical @1 definitions.
export const TERMINAL_FOLLOW_UP_RULES = Object.freeze([
  Object.freeze({ key: 'github.pull-request.merged', revision: 1, scenarioKey: 'work.tasks', scenarioRevision: 2,
    resourceType: 'PullRequest', factKey: 'pull_request.state', capabilityKey: 'READ_PULL_REQUEST', field: 'merged', terminal: true }),
  Object.freeze({ key: 'github.workflow.completed', revision: 1, scenarioKey: 'work.recurring_work', scenarioRevision: 2,
    resourceType: 'Workflow', factKey: 'workflow.run_status', capabilityKey: 'READ_WORKFLOW_STATUS', field: 'status', terminal: 'completed' }),
] as const);
export type TerminalFollowUpRule = typeof TERMINAL_FOLLOW_UP_RULES[number];

export function terminalFollowUpRule(scenarioKey: string, revision: number): TerminalFollowUpRule | undefined {
  return TERMINAL_FOLLOW_UP_RULES.find((rule) => rule.scenarioKey === scenarioKey && rule.scenarioRevision === revision);
}
export function scenarioByRevision(key: string, revision: number): ScenarioDefinition | undefined {
  if (revision === 1) return scenarioByKey(key) ?? undefined;
  const rule = terminalFollowUpRule(key, revision);
  return rule ? terminalFollowUpScenario(rule) : undefined;
}
export function terminalFollowUpScenario(rule: TerminalFollowUpRule): ScenarioDefinition {
  const original = scenarioByKey(rule.scenarioKey);
  if (!original) throw new Error('Terminal scenario is outside the canonical catalog');
  return { ...original, revision: rule.scenarioRevision,
    primaryResourceTypes: [rule.resourceType], requiredFacts: [rule.factKey], optionalFacts: [],
    defaultStrategy: 'SILENT_FOLLOW_UP', supportedStrategies: ['SILENT_FOLLOW_UP'],
    sourceRequirements: [{ operation: 'READ', resourceType: rule.resourceType, capabilityKey: rule.capabilityKey, optional: false }],
    actionRequirements: [], conditionSchema: { factKey: rule.factKey, operators: ['EQ', 'CHANGED'] },
    minimumReality: 'VERIFIED', defaultRiskFloor: 'R1',
    freshnessPolicy: { onStale: 'BLOCK', maximumAgeSeconds: 300 } };
}
export function buildTerminalFollowUpRuntime(rule: TerminalFollowUpRule, subjectKey?: string): CompiledStrategyRuntime {
  const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  if (!subjectKey || !new RegExp(`^${uuid}:[1-9][0-9]*:${rule.resourceType}:[1-9][0-9]*$`, 'i').test(subjectKey)) {
    throw new Error('Terminal follow-up requires an exact connection/repository/resource subject');
  }
  const { runtimeHash: _oldHash, ...original } = buildStrategyRuntime(terminalFollowUpScenario(rule), 'SILENT_FOLLOW_UP', subjectKey);
  const runtime = { ...original, actionMode: 'REMIND' as const, verificationPolicy: 'RECORD_ONLY' as const,
    conditionAst: { kind: 'GROUP' as const, operator: 'ALL' as const, children: [
      { kind: 'PREDICATE' as const, operator: 'CHANGED' as const, factKey: rule.factKey },
      { kind: 'PREDICATE' as const, operator: 'EQ' as const, factKey: rule.factKey, comparisonValue: rule.terminal },
    ] }, dependencies: [{ factKey: rule.factKey, resourceType: rule.resourceType, field: rule.field,
      scope: 'EXACT_SUBJECT' as const, subjectKey }] };
  // A terminal initial snapshot is a baseline, not a transition notification.
  return { ...runtime, runtimeHash: createHash('sha256').update(canonicalStringify(runtime)).digest('hex') };
}
