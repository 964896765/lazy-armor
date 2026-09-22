import type { JsonValue, ActionType, StrategyKey } from './index';

/**
 * R3 declarative Action Recipe / Blueprint.
 *
 * A Recipe is a static product contract that maps Scenario + Strategy to an
 * ordered sequence of Plan actions. It contains no user runtime state. The Plan
 * Compiler only turns a Recipe into existing Plan Actions; the Executor still
 * applies the normal risk / approval / capability / verification boundaries.
 *
 * The generic `actionMode → action` mapping remains the fallback for scenarios
 * that do not declare a Recipe, so existing plans stay compatible.
 */
export interface ActionRecipeStep {
  actionType: ActionType;
  config: Record<string, JsonValue>;
}

export interface ActionRecipe {
  key: string;
  scenarioKey: string;
  scenarioRevision: number;
  strategy: StrategyKey;
  steps: readonly ActionRecipeStep[];
}

const step = (actionType: ActionType, config: Record<string, JsonValue> = {}): ActionRecipeStep => ({ actionType, config });

export const ACTION_RECIPES: readonly ActionRecipe[] = Object.freeze([
  Object.freeze({
    key: 'finance.abnormal_transaction.anomaly',
    scenarioKey: 'finance.abnormal_transaction',
    scenarioRevision: 2,
    strategy: 'ANOMALY_DETECTION',
    steps: Object.freeze([
      step('classify', {}),
      step('summarize', { domain: 'billing', summaryType: 'daily_account' }),
      step('notify', { channel: 'in_app', priority: 'P2', eventType: 'daily_account_summary', templateKey: 'finance.abnormal_transaction' }),
      step('record', { recordType: 'finance.abnormal_transaction' }),
    ]),
  }),
  Object.freeze({
    key: 'daily_life.delivery.silent',
    scenarioKey: 'daily_life.delivery',
    scenarioRevision: 2,
    strategy: 'SILENT_FOLLOW_UP',
    steps: Object.freeze([
      step('summarize', { domain: 'logistics', notifyOnDelivered: true }),
      step('notify', { channel: 'in_app', priority: 'P2', eventType: 'shipment_follow_up', templateKey: 'daily_life.delivery' }),
      step('record', { recordType: 'daily_life.delivery' }),
    ]),
  }),
  Object.freeze({
    key: 'device.consumables.predictive',
    scenarioKey: 'device.consumables',
    scenarioRevision: 2,
    strategy: 'PREDICTIVE_PREPARE',
    steps: Object.freeze([
      step('summarize', { domain: 'device' }),
      step('prepare_purchase', { domain: 'device' }),
      step('notify', { channel: 'in_app', priority: 'P2', eventType: 'device_consumable_due', templateKey: 'device.consumables' }),
      step('record', { recordType: 'device.consumables' }),
    ]),
  }),
  Object.freeze({
    key: 'family.family_supply.predictive',
    scenarioKey: 'family.family_supply',
    scenarioRevision: 2,
    strategy: 'PREDICTIVE_PREPARE',
    steps: Object.freeze([
      step('summarize', { domain: 'household' }),
      step('prepare_purchase', { domain: 'household' }),
      step('notify', { channel: 'in_app', priority: 'P2', eventType: 'household_supply_reminder', templateKey: 'family.family_supply' }),
      step('record', { recordType: 'family.family_supply' }),
    ]),
  }),
  Object.freeze({
    key: 'daily_life.errands.summary',
    scenarioKey: 'daily_life.errands',
    scenarioRevision: 2,
    strategy: 'PERIODIC_SUMMARY',
    steps: Object.freeze([
      step('summarize', { domain: 'daily_summary' }),
      step('notify', { channel: 'in_app', priority: 'P2', eventType: 'daily_important_summary', templateKey: 'daily_life.errands' }),
      step('record', { recordType: 'daily_life.errands' }),
    ]),
  }),
]);

export function resolveActionRecipe(scenarioKey: string, scenarioRevision: number, strategy: StrategyKey): ActionRecipe | null {
  return ACTION_RECIPES.find((recipe) => recipe.scenarioKey === scenarioKey && recipe.scenarioRevision === scenarioRevision && recipe.strategy === strategy) ?? null;
}

/** Compiles a Recipe into ordered Plan action inputs (stepOrder assigned sequentially). */
export function compileActionRecipe(recipe: ActionRecipe): Array<{ actionType: ActionType; config: Record<string, JsonValue>; stepOrder: number }> {
  return recipe.steps.map((recipeStep, index) => ({ actionType: recipeStep.actionType, config: recipeStep.config, stepOrder: index }));
}
