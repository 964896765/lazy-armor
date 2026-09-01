import { beforeAll, describe, expect, it } from 'vitest';

describe('P0-5 deterministic ConditionEvaluator', () => {
  let evaluator: { evaluateOne(condition: unknown, context: Record<string, unknown>): boolean };
  beforeAll(async () => {
    const { ConditionEvaluator } = await import('../dist/execution/condition-evaluator.service.js');
    evaluator = new ConditionEvaluator();
  });
  const check = (operator: string, value: unknown, comparisonValue?: unknown) => evaluator.evaluateOne({ groupId: 'root', logicalOperator: 'AND', fieldPath: 'value', operator, comparisonValue: comparisonValue ?? null, sortOrder: 0 }, { value });

  it('EQ', () => expect(check('EQ', { b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true));
  it('NE', () => expect(check('NE', 1, 2)).toBe(true));
  it('GT', () => expect(check('GT', 3, 2)).toBe(true));
  it('GTE', () => expect(check('GTE', 2, 2)).toBe(true));
  it('LT', () => expect(check('LT', 1, 2)).toBe(true));
  it('LTE', () => expect(check('LTE', 2, 2)).toBe(true));
  it('IN', () => expect(check('IN', 'a', ['a', 'b'])).toBe(true));
  it('NOT_IN', () => expect(check('NOT_IN', 'c', ['a', 'b'])).toBe(true));
  it('CONTAINS', () => expect(check('CONTAINS', 'lazy armor', 'armor')).toBe(true));
  it('CHANGED', () => expect(check('CHANGED', { previous: 1, current: 2 })).toBe(true));
  it('PERCENT_CHANGE_GT', () => expect(check('PERCENT_CHANGE_GT', { previous: 100, current: 130 }, 20)).toBe(true));
  it('TIME_RANGE', () => expect(check('TIME_RANGE', '23:00', ['22:00', '02:00'])).toBe(true));
  it('EXISTS', () => expect(check('EXISTS', false)).toBe(true));
  it('NOT_EXISTS', () => expect(evaluator.evaluateOne({ groupId: 'root', logicalOperator: 'AND', fieldPath: 'missing', operator: 'NOT_EXISTS', comparisonValue: null, sortOrder: 0 }, {})).toBe(true));
  it('rejects invalid numeric input instead of treating it as false', () => expect(() => check('GT', 'abc', 2)).toThrow(/finite numbers/));
  it('combines AND/OR deterministically', async () => {
    const instance = evaluator as unknown as { evaluate(conditions: unknown[], context: Record<string, unknown>): boolean };
    expect(instance.evaluate([
      { groupId: 'root', logicalOperator: 'AND', fieldPath: 'a', operator: 'EQ', comparisonValue: 1, sortOrder: 0 },
      { groupId: 'root', logicalOperator: 'OR', fieldPath: 'b', operator: 'EQ', comparisonValue: 2, sortOrder: 1 },
    ], { a: 0, b: 2 })).toBe(true);
  });
});
