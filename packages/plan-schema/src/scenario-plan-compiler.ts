import { compileActionRecipe, normalizePlanDefinition, resolveActionRecipe, type PlanDefinition, type PlanDefinitionInput } from './index';
import { evaluateScenarioReadiness, scenarioByKey, type ScenarioReadinessInput, type StrategyKey } from './runtime-catalog';
import { productDomainFromStorageKey } from './product-model';
import { buildStrategyRuntime, type CompiledStrategyRuntime } from './strategy-runtime';
import { buildTerminalFollowUpRuntime, terminalFollowUpRule, terminalFollowUpScenario, terminalTargetConfig, validateTerminalTarget, type TerminalHandoffTarget } from './terminal-follow-up';

export interface ScenarioCompileInput {
  scenarioKey: string;
  scenarioRevision?: number;
  strategy?: StrategyKey;
  name?: string;
  mode?: 'DRAFT' | 'EXECUTABLE';
  readiness?: ScenarioReadinessInput;
  subjectKey?: string;
  target?: TerminalHandoffTarget;
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
  const revision = input.scenarioRevision ?? 1;
  const terminalRule = terminalFollowUpRule(input.scenarioKey, revision);
  const scenario = terminalRule ? terminalFollowUpScenario(terminalRule) : revision === 1 ? scenarioByKey(input.scenarioKey) : undefined;
  if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioKey}`);
  const strategy = input.strategy ?? scenario.defaultStrategy;
  if (!scenario.supportedStrategies.includes(strategy)) throw new Error(`Strategy ${strategy} is not supported by ${scenario.key}`);
  const mode = input.mode ?? 'DRAFT';
  const readiness = evaluateScenarioReadiness(scenario, input.readiness);
  if (mode === 'EXECUTABLE' && !['ASSISTED_READY', 'AUTOMATED_READY'].includes(readiness.state)) throw new Error(`Scenario ${scenario.key} is not executable: ${readiness.state}`);
  const productDomain = productDomainFromStorageKey(scenario.domain);
  if (!productDomain) throw new Error(`Scenario domain is not in the product catalog: ${scenario.domain}`);
  const runtime = terminalRule ? buildTerminalFollowUpRuntime(terminalRule, input.subjectKey) : buildStrategyRuntime(scenario, strategy, input.subjectKey ?? null);
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
  if (terminalRule) {
    const target = validateTerminalTarget(terminalRule, input.target);
    definitionInput.conditions = [{ groupId: 'root', logicalOperator: 'AND', fieldPath: `${terminalRule.factKey}.${terminalRule.field}`,
      operator: terminalRule.condition === 'EXISTS' ? 'EXISTS' : 'EQ', ...(terminalRule.condition === 'EXISTS' ? {} : { comparisonValue: terminalRule.terminal }), sortOrder: 0 }];
    definitionInput.actions = target && terminalRule.target ? [
      { actionType: 'publish', connectorKey: terminalRule.target.providerKey, connectionId: target.connectionId, requiredCapability: terminalRule.target.capabilityKey,
        config: { visibility: 'private', handoffTarget: terminalTargetConfig(terminalRule, target)! }, stepOrder: 0 },
      { actionType: 'record', config: { recordType: terminalRule.key }, stepOrder: 1 },
    ] : [
      { actionType: 'notify', config: { channel: 'in_app', priority: 'P2', eventType: 'github_terminal_follow_up', templateKey: terminalRule.key }, stepOrder: 0 },
      { actionType: 'record', config: { recordType: terminalRule.key }, stepOrder: 1 },
    ];
  }
  // R3 declarative Action Recipe overrides the generic single action for
  // non-terminal scenarios. The generic actionMode mapping stays the fallback.
  const recipe = terminalRule ? null : resolveActionRecipe(input.scenarioKey, revision, strategy);
  if (recipe) {
    definitionInput.actions = compileActionRecipe(recipe);
    if (recipe.steps.some((step) => step.actionType === 'summarize' && step.config.domain === 'daily_summary')) {
      definitionInput.sources = [...definitionInput.sources, { sourceType: 'internal', config: { resource: 'important_item_candidates' }, sortOrder: definitionInput.sources.length }];
    }
  }
  const definition = normalizePlanDefinition(definitionInput);
  return { scenarioKey: scenario.key, scenarioRevision: scenario.revision, strategy, mode, readiness, runtime, definitionInput, definition };
}

function approvalFor(policy: CompiledStrategyRuntime['approvalPolicy'], riskLevel: string): PlanDefinitionInput['approvalPolicy'] {
  if (policy === 'NEVER_EXTERNAL') return { type: 'never', config: {} };
  // External-effect actions are R2+; local observe/prepare actions are R1.
  // "Always for external" must therefore approve above R1, not every local step.
  if (policy === 'ALWAYS_FOR_EXTERNAL') return { type: 'above_risk_level', config: { riskLevel: 'R1' } };
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
