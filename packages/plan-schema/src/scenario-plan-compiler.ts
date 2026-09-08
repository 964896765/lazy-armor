import { normalizePlanDefinition, type PlanDefinition } from './index';
import { evaluateScenarioReadiness, scenarioByKey, type ScenarioReadinessInput, type StrategyKey } from './runtime-catalog';
import { productDomainFromStorageKey } from './product-model';

export interface ScenarioCompileInput {
  scenarioKey: string;
  strategy?: StrategyKey;
  name?: string;
  mode?: 'DRAFT' | 'EXECUTABLE';
  readiness?: ScenarioReadinessInput;
}

export interface CompiledScenarioPlan {
  scenarioKey: string;
  scenarioRevision: number;
  strategy: StrategyKey;
  mode: 'DRAFT' | 'EXECUTABLE';
  readiness: ReturnType<typeof evaluateScenarioReadiness>;
  definition: PlanDefinition;
}

/** Compiles a catalog scenario into the existing Plan Engine schema; it never creates a parallel engine. */
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
  const definition = normalizePlanDefinition({
    name: input.name ?? scenario.label,
    description: `${scenario.label} · ${strategy} · Scenario ${scenario.key}@${scenario.revision}`,
    domain: productDomain.storageKey,
    automationLevel: mode === 'EXECUTABLE' ? 'L2' : 'L0',
    approvalPolicy: { type: 'above_risk_level', config: { riskLevel: scenario.defaultRiskFloor } },
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
    conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: scenario.requiredFacts[0], operator: 'EXISTS', sortOrder: 0 }],
    actions: [{ actionType: 'notify', requiredCapability: 'SEND_NOTIFICATION', config: { channel: 'in_app', templateKey: `scenario.${scenario.key}` }, stepOrder: 0 }],
  });
  return { scenarioKey: scenario.key, scenarioRevision: scenario.revision, strategy, mode, readiness, definition };
}
