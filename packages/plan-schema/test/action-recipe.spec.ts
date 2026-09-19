import { describe, expect, it } from 'vitest';
import { ACTION_RECIPES, compileScenarioPlan, resolveActionRecipe } from '../src';

describe('R3 declarative action recipe registry', () => {
  it('registers exactly the five R3 golden-journey recipes', () => {
    expect(ACTION_RECIPES.map((recipe) => recipe.key).sort()).toEqual([
      'daily_life.delivery.silent',
      'daily_life.errands.summary',
      'device.consumables.predictive',
      'family.family_supply.predictive',
      'finance.abnormal_transaction.anomaly',
    ]);
  });

  it('resolves the account-journey recipe into an ordered action sequence', () => {
    const recipe = resolveActionRecipe('finance.abnormal_transaction', 1, 'ANOMALY_DETECTION');
    expect(recipe).not.toBeNull();
    expect(recipe!.steps.map((step) => step.actionType)).toEqual(['classify', 'summarize', 'notify', 'record']);
  });

  it('compiles the recipe into a plan instead of the generic single action', () => {
    const compiled = compileScenarioPlan({ scenarioKey: 'finance.abnormal_transaction', strategy: 'ANOMALY_DETECTION', name: '账目整理' });
    expect(compiled.definition.actions.map((action) => action.actionType)).toEqual(['classify', 'summarize', 'notify', 'record']);
    expect(compiled.definition.actions.every((action, index) => action.stepOrder === index)).toBe(true);
  });

  it('keeps the generic actionMode fallback for scenarios without a recipe', () => {
    const compiled = compileScenarioPlan({ scenarioKey: 'finance.bill', strategy: 'PERIODIC_SUMMARY', name: '账单' });
    expect(compiled.definition.actions.map((action) => action.actionType)).toEqual(['notify']);
  });
});
