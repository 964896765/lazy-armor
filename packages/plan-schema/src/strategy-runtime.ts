import { createHash } from 'node:crypto';
import { canonicalStringify } from './index';
import { PLAN_EXECUTION_LIFECYCLE } from './product-model';
import { STRATEGY_PROFILES, type ScenarioDefinition, type StrategyKey } from './runtime-catalog';

export const CONDITION_AST_SCHEMA_VERSION = '1' as const;
export const OPERATOR_REGISTRY_REVISION = 1 as const;
export const CONDITION_OPERATORS_V1 = [
  'EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'EXISTS',
  'CHANGED', 'CHANGED_BY', 'COUNT', 'WITHIN_WINDOW', 'ALL', 'ANY', 'NOT',
] as const;

export type RuntimeConditionOperator = typeof CONDITION_OPERATORS_V1[number];
export type RuntimeLeafOperator = Exclude<RuntimeConditionOperator, 'ALL' | 'ANY' | 'NOT'>;
export type FactDependencyScope = 'EXACT_SUBJECT' | 'RESOURCE_WIDE' | 'USER_AGGREGATE' | 'SCHEDULED';
export type LifecycleRuntimeState = 'NOT_STARTED' | 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'BLOCKED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface ConditionPredicate {
  kind: 'PREDICATE';
  operator: RuntimeLeafOperator;
  factKey: string;
  comparisonValue?: unknown;
}

export interface ConditionGroup {
  kind: 'GROUP';
  operator: 'ALL' | 'ANY';
  children: ConditionAst[];
}

export interface ConditionNegation {
  kind: 'NOT';
  operator: 'NOT';
  child: ConditionAst;
}

export type ConditionAst = ConditionPredicate | ConditionGroup | ConditionNegation;

export interface RuntimeFactInput {
  value: unknown;
  previousValue?: unknown;
  truthVersionId: string;
  verifiedAt: string;
}

export interface ConditionEvaluationContext {
  facts: Record<string, RuntimeFactInput>;
  evaluatedAt: string;
}

export interface ConditionDecision {
  schemaVersion: typeof CONDITION_AST_SCHEMA_VERSION;
  operatorRegistryRevision: typeof OPERATOR_REGISTRY_REVISION;
  result: boolean;
  truthVersionIds: string[];
  evaluatedInputValues: Record<string, { value: unknown; previousValue?: unknown }>;
  trace: Array<{ path: string; operator: RuntimeConditionOperator; result: boolean }>;
  evaluatedAt: string;
}

export interface FactDependencyDefinition {
  factKey: string;
  resourceType: string;
  field: string;
  scope: FactDependencyScope;
  subjectKey: string | null;
}

export interface StrategyTriggerProfile {
  schemaVersion: '1';
  strategy: StrategyKey;
  acceptedModes: readonly ('MANUAL' | 'SCHEDULE' | 'EVENT' | 'FACT_CHANGED' | 'THRESHOLD')[];
  defaultMode: 'MANUAL' | 'SCHEDULE' | 'EVENT' | 'FACT_CHANGED' | 'THRESHOLD';
  dedupeWindowSeconds: number;
  schedule: { cronExpression: string; timezone: string } | null;
  deterministic: true;
}

export interface CompiledStrategyRuntime {
  schemaVersion: '1';
  scenarioKey: string;
  scenarioRevision: number;
  strategy: StrategyKey;
  strategyRevision: number;
  actionMode: 'OBSERVE' | 'REMIND' | 'PREPARE' | 'EXECUTE';
  attentionPolicy: 'ALWAYS' | 'ON_CHANGE' | 'ON_EXCEPTION' | 'PERIODIC';
  approvalPolicy: 'NEVER_EXTERNAL' | 'RISK_BASED' | 'ALWAYS_FOR_EXTERNAL';
  verificationPolicy: 'RECORD_ONLY' | 'READ_BACK' | 'CALLBACK_OR_READ_BACK';
  allowedAutomationCeiling: string;
  triggerProfile: StrategyTriggerProfile;
  conditionAst: ConditionAst;
  dependencies: FactDependencyDefinition[];
  lifecycle: Array<{ step: number; key: string; label: string; state: LifecycleRuntimeState }>;
  runtimeHash: string;
}

export const OPERATOR_REGISTRY = Object.freeze(CONDITION_OPERATORS_V1.map((key) => Object.freeze({
  key,
  revision: OPERATOR_REGISTRY_REVISION,
  deterministic: true as const,
  acceptsChildren: ['ALL', 'ANY', 'NOT'].includes(key),
})));

export function evaluateConditionAst(ast: ConditionAst, context: ConditionEvaluationContext): ConditionDecision {
  const evaluatedAt = new Date(context.evaluatedAt);
  if (!Number.isFinite(evaluatedAt.getTime())) throw new Error('evaluatedAt must be an ISO date');
  const trace: ConditionDecision['trace'] = [];
  const inputs: ConditionDecision['evaluatedInputValues'] = {};
  const versions = new Set<string>();

  const visit = (node: ConditionAst, path: string): boolean => {
    let result: boolean;
    if (node.kind === 'GROUP') {
      if (node.children.length === 0) throw new Error(`${node.operator} requires at least one child`);
      const values = node.children.map((child, index) => visit(child, `${path}.${index}`));
      result = node.operator === 'ALL' ? values.every(Boolean) : values.some(Boolean);
    } else if (node.kind === 'NOT') {
      result = !visit(node.child, `${path}.0`);
    } else {
      const fact = context.facts[node.factKey];
      if (fact) {
        versions.add(fact.truthVersionId);
        inputs[node.factKey] = { value: fact.value, ...(fact.previousValue !== undefined ? { previousValue: fact.previousValue } : {}) };
      }
      result = evaluatePredicate(node, fact, evaluatedAt);
    }
    trace.push({ path, operator: node.operator, result });
    return result;
  };

  return {
    schemaVersion: CONDITION_AST_SCHEMA_VERSION,
    operatorRegistryRevision: OPERATOR_REGISTRY_REVISION,
    result: visit(ast, 'root'),
    truthVersionIds: [...versions].sort(),
    evaluatedInputValues: inputs,
    trace,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

function evaluatePredicate(node: ConditionPredicate, fact: RuntimeFactInput | undefined, evaluatedAt: Date): boolean {
  const value = fact?.value;
  switch (node.operator) {
    case 'EXISTS': return fact !== undefined && value !== null && value !== undefined;
    case 'CHANGED': return fact !== undefined && fact.previousValue !== undefined && !deepEqual(value, fact.previousValue);
    case 'CHANGED_BY': return typeof value === 'number' && typeof fact?.previousValue === 'number' && typeof node.comparisonValue === 'number'
      && Math.abs(value - fact.previousValue) >= node.comparisonValue;
    case 'EQ': return deepEqual(value, node.comparisonValue);
    case 'NE': return !deepEqual(value, node.comparisonValue);
    case 'GT': return comparable(value, node.comparisonValue, (left, right) => left > right);
    case 'GTE': return comparable(value, node.comparisonValue, (left, right) => left >= right);
    case 'LT': return comparable(value, node.comparisonValue, (left, right) => left < right);
    case 'LTE': return comparable(value, node.comparisonValue, (left, right) => left <= right);
    case 'IN': return Array.isArray(node.comparisonValue) && node.comparisonValue.some((item) => deepEqual(item, value));
    case 'NOT_IN': return Array.isArray(node.comparisonValue) && !node.comparisonValue.some((item) => deepEqual(item, value));
    case 'CONTAINS': return typeof value === 'string'
      ? typeof node.comparisonValue === 'string' && value.includes(node.comparisonValue)
      : Array.isArray(value) && value.some((item) => deepEqual(item, node.comparisonValue));
    case 'COUNT': return Array.isArray(value) && typeof node.comparisonValue === 'number' && value.length >= node.comparisonValue;
    case 'WITHIN_WINDOW': {
      if (typeof value !== 'string' || typeof node.comparisonValue !== 'number' || node.comparisonValue < 0) return false;
      const target = new Date(value).getTime();
      return Number.isFinite(target) && target >= evaluatedAt.getTime() && target - evaluatedAt.getTime() <= node.comparisonValue * 1000;
    }
  }
}

function comparable(left: unknown, right: unknown, compare: (left: number | string, right: number | string) => boolean) {
  if (typeof left === 'number' && typeof right === 'number') return compare(left, right);
  if (typeof left === 'string' && typeof right === 'string') return compare(left, right);
  return false;
}

function deepEqual(left: unknown, right: unknown) { return canonicalStringify(left) === canonicalStringify(right); }

export function buildStrategyRuntime(scenario: ScenarioDefinition, strategy: StrategyKey, subjectKey: string | null = null): CompiledStrategyRuntime {
  const profile = STRATEGY_PROFILES.find((item) => item.key === strategy);
  if (!profile) throw new Error(`Unknown strategy: ${strategy}`);
  const factKey = scenario.requiredFacts[0];
  if (!factKey) throw new Error(`Scenario ${scenario.key} has no required fact`);
  const resourceType = scenario.primaryResourceTypes[0];
  if (!resourceType) throw new Error(`Scenario ${scenario.key} has no primary resource`);
  const triggerProfile = triggerProfileFor(strategy, profile.triggerModes);
  const conditionAst = conditionFor(strategy, factKey);
  const scope: FactDependencyScope = strategy === 'PERIODIC_SUMMARY' ? 'USER_AGGREGATE' : subjectKey ? 'EXACT_SUBJECT' : 'RESOURCE_WIDE';
  const dependencies: FactDependencyDefinition[] = [{ factKey, resourceType, field: factKey.split('.').at(-1) ?? 'value', scope, subjectKey: scope === 'EXACT_SUBJECT' ? subjectKey : null }];
  if (triggerProfile.defaultMode === 'SCHEDULE') dependencies.push({ factKey, resourceType, field: factKey.split('.').at(-1) ?? 'value', scope: 'SCHEDULED', subjectKey: null });
  const base = {
    schemaVersion: '1' as const,
    scenarioKey: scenario.key,
    scenarioRevision: scenario.revision,
    strategy,
    strategyRevision: profile.revision,
    actionMode: profile.defaultActionMode,
    attentionPolicy: profile.attentionPolicy,
    approvalPolicy: profile.approvalPolicy,
    verificationPolicy: profile.verificationPolicy,
    allowedAutomationCeiling: profile.allowedAutomationCeiling,
    triggerProfile,
    conditionAst,
    dependencies,
    lifecycle: PLAN_EXECUTION_LIFECYCLE.map((step) => ({ ...step, state: 'NOT_STARTED' as const })),
  };
  return { ...base, runtimeHash: createHash('sha256').update(canonicalStringify(base)).digest('hex') };
}

function triggerProfileFor(strategy: StrategyKey, acceptedModes: StrategyTriggerProfile['acceptedModes']): StrategyTriggerProfile {
  const defaultMode: StrategyTriggerProfile['defaultMode'] = strategy === 'PERIODIC_SUMMARY' || strategy === 'EXPIRY_GUARD'
    ? 'SCHEDULE' : strategy === 'ASSISTED_ACTION' ? 'MANUAL' : strategy === 'AUTOMATED_ACTION' ? 'EVENT' : 'FACT_CHANGED';
  return {
    schemaVersion: '1', strategy, acceptedModes, defaultMode,
    dedupeWindowSeconds: strategy === 'ANOMALY_DETECTION' ? 3_600 : 300,
    schedule: defaultMode === 'SCHEDULE' ? { cronExpression: '0 9 * * *', timezone: 'Asia/Shanghai' } : null,
    deterministic: true,
  };
}

function conditionFor(strategy: StrategyKey, factKey: string): ConditionAst {
  switch (strategy) {
    case 'STATE_GUARD': return { kind: 'PREDICATE', operator: 'CHANGED', factKey };
    case 'EXPIRY_GUARD': return { kind: 'PREDICATE', operator: 'WITHIN_WINDOW', factKey, comparisonValue: 30 * 86_400 };
    case 'ANOMALY_DETECTION': return { kind: 'PREDICATE', operator: 'CHANGED_BY', factKey, comparisonValue: 1 };
    case 'SILENT_FOLLOW_UP': return { kind: 'PREDICATE', operator: 'CHANGED', factKey };
    case 'PERIODIC_SUMMARY': return { kind: 'PREDICATE', operator: 'EXISTS', factKey };
    case 'PREDICTIVE_PREPARE': return { kind: 'PREDICATE', operator: 'LTE', factKey, comparisonValue: 30 };
    case 'ASSISTED_ACTION': return { kind: 'PREDICATE', operator: 'EXISTS', factKey };
    case 'AUTOMATED_ACTION': return { kind: 'PREDICATE', operator: 'EXISTS', factKey };
  }
}
