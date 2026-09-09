import { normalizePlanDefinition, type PlanDefinition, type PlanDefinitionInput } from './index';
import { evaluateScenarioReadiness, scenarioByKey, type ScenarioReadinessInput, type StrategyKey } from './runtime-catalog';
import { productDomainFromStorageKey } from './product-model';
import { buildStrategyRuntime, type CompiledStrategyRuntime } from './strategy-runtime';

export interface ScenarioCompileInput {
  scenarioKey: string;
  strategy?: StrategyKey;
  name?: string;
  mode?: 'DRAFT' | 'EXECUTABLE';
  readiness?: ScenarioReadinessInput;
  subjectKey?: string;
}

export interface CompiledScenarioPlan {
  scenarioKey: string;
  scenarioRevision: number;
  strategy: StrategyKey;
  mode: 'DRAFT' | 'EXECUTABLE';
  readiness: ReturnType<typeof evaluateScenarioReadiness>;
  runtime: CompiledStrategyRuntime;
  definitionInput: PlanDefinitionInput;
  definition: PlanDefinition;
}

/** Compiles a catalog scenario and strategy into the existing Plan Engine schema. */
export function compileScenarioPlan(input: ScenarioCompileInput): CompiledScenarioPlan {
  const scenario = scenarioByKey(input.scenarioKey);
  if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioKey}`);
  const strategy = input.strategy ?? scenario.defaultStrategy;
  if (!scenario.supportedStrategies.includes(strategy)) throw new Error(`Strategy ${strategy} is not supported by ${scenario.key}`);
  const mode = input.mode ?? 'DRAFT';
  const readiness = evaluateScenarioReadiness(scenario, input.readiness);
  if (mode === 'EXECUTABLE' && !['ASSISTED_READY', 'AUTOMATED_READY'].includes(readiness.state)) {
    throw new Error(`Scenario ${scenario.key} is not executable: ${readiness.state}`);
  }
  const productDomain = productDomainFromStorageKey(scenario.domain);
  if (!productDomain) throw new Error(`Scenario domain is not in the product catalog: ${scenario.domain}`);
  const runtime = buildStrategyRuntime(scenario, strategy, input.subjectKey ?? null);
  const definitionInput: PlanDefinitionInput = {
    name: input.name ?? scenario.label,
    description: `${scenario.label} · ${strategy} · Scenario ${scenario.key}@${scenario.revision}`,
    domain: productDomain.storageKey,
    automationLevel: mode === 'EXECUTABLE' ? (runtime.actionMode === 'EXECUTE' ? 'L2' : 'L1') : 'L0',
    approvalPolicy: approvalFor(runtime.approvalPolicy, scenario.defaultRiskFloor),
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    triggers: [triggerFor(runtime, scenario.requiredFacts[0])],
    conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: scenario.requiredFacts[0], operator: 'EXISTS', sortOrder: 0 }],
    actions: [actionFor(runtime.actionMode, scenario.key, productDomain.storageKey)],
  };
  const definition = normalizePlanDefinition(definitionInput);
  return { scenarioKey: scenario.key, scenarioRevision: scenario.revision, strategy, mode, readiness, runtime, definitionInput, definition };
}

function approvalFor(policy: CompiledStrategyRuntime['approvalPolicy'], riskLevel: string): PlanDefinitionInput['approvalPolicy'] {
  if (policy === 'NEVER_EXTERNAL') return { type: 'never', config: {} };
  if (policy === 'ALWAYS_FOR_EXTERNAL') return { type: 'always', config: {} };
  return { type: 'above_risk_level', config: { riskLevel } };
}

function triggerFor(runtime: CompiledStrategyRuntime, factKey: string): PlanDefinitionInput['triggers'][number] {
  switch (runtime.triggerProfile.defaultMode) {
    case 'SCHEDULE': return { triggerType: 'schedule', config: runtime.triggerProfile.schedule!, sortOrder: 0 };
    case 'FACT_CHANGED': return { triggerType: 'data_changed', config: { fieldPath: factKey }, sortOrder: 0 };
    case 'THRESHOLD': return { triggerType: 'threshold', config: { fieldPath: factKey, direction: 'above', value: 0 }, sortOrder: 0 };
    case 'EVENT': return { triggerType: 'event', config: { eventType: `truth.${factKey}.changed` }, sortOrder: 0 };
    case 'MANUAL': return { triggerType: 'manual', config: {}, sortOrder: 0 };
  }
}

function actionFor(mode: CompiledStrategyRuntime['actionMode'], scenarioKey: string, domain: string): PlanDefinitionInput['actions'][number] {
  if (mode === 'OBSERVE') return { actionType: 'record', config: { recordType: `scenario.${scenarioKey}` }, stepOrder: 0 };
  if (mode === 'PREPARE') return { actionType: 'create_draft', config: { draftType: `scenario.${scenarioKey}`, domain }, stepOrder: 0 };
  if (mode === 'EXECUTE') return { actionType: 'update_internal_record', config: { recordType: `scenario.${scenarioKey}` }, stepOrder: 0 };
  return { actionType: 'notify', config: { channel: 'in_app', templateKey: `scenario.${scenarioKey}` }, stepOrder: 0 };
}
