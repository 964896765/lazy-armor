import { describe, expect, it } from 'vitest';
import { ACTION_RECIPES, compileScenarioPlan, resolveActionRecipe, scenarioDefinitionByKey } from '../src';

describe('R3 declarative action recipe registry', () => {
  it('registers golden-journey recipes including the V2 accounting loop', () => {
    expect(ACTION_RECIPES.map((recipe) => recipe.key).sort()).toEqual([
      'daily_life.delivery.silent',
      'daily_life.errands.summary',
      'device.consumables.predictive',
      'family.family_supply.predictive',
      'finance.abnormal_transaction.anomaly',
      'finance.accounting.periodic',
    ]);
  });

  it('resolves the account-journey recipe into an ordered action sequence', () => {
    const recipe = resolveActionRecipe('finance.abnormal_transaction', 2, 'ANOMALY_DETECTION');
    expect(recipe).not.toBeNull();
    expect(recipe!.steps.map((step) => step.actionType)).toEqual(['classify', 'summarize', 'notify', 'record']);
  });

  it('keeps every golden-journey recipe on its current immutable scenario revision', () => {
    for (const recipe of ACTION_RECIPES) {
      expect(recipe.scenarioRevision).toBe(scenarioDefinitionByKey(recipe.scenarioKey)?.revision);
      expect(resolveActionRecipe(recipe.scenarioKey, recipe.scenarioRevision, recipe.strategy)).toBe(recipe);
    }
  });

  it('compiles the recipe into a plan instead of the generic single action', () => {
    const compiled = compileScenarioPlan({ scenarioKey: 'finance.abnormal_transaction', strategy: 'ANOMALY_DETECTION', name: '账目整理' });
    expect(compiled.definition.actions.map((action) => action.actionType)).toEqual(['classify', 'summarize', 'notify', 'record']);
    expect(compiled.definition.actions.every((action, index) => action.stepOrder === index)).toBe(true);
  });

  it('compiles finance.accounting through verified Truth and the shared action chain', () => {
    const compiled = compileScenarioPlan({ scenarioKey: 'finance.accounting', scenarioRevision: 1, strategy: 'PERIODIC_SUMMARY', subjectKey: 'finance.transaction:local_file:txn-1' });
    expect(compiled.definition.sources).toEqual([expect.objectContaining({ sourceType: 'internal', config: { resource: 'finance.transaction' }, sortOrder: 0 })]);
    expect(compiled.definition.actions.map((action) => action.actionType)).toEqual(['classify', 'summarize', 'compare', 'notify', 'record']);
  });

  it('keeps the generic actionMode fallback for scenarios without a recipe', () => {
    const compiled = compileScenarioPlan({ scenarioKey: 'finance.bill', strategy: 'PERIODIC_SUMMARY', name: '账单' });
    expect(compiled.definition.actions.map((action) => action.actionType)).toEqual(['notify']);
  });
});
