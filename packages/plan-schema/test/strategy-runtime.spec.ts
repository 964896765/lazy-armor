import { describe, expect, it } from 'vitest';
import {
  CONDITION_OPERATORS_V1, OPERATOR_REGISTRY, PLAN_EXECUTION_LIFECYCLE, compileScenarioPlan,
  evaluateConditionAst, type StrategyKey,
} from '../src';

const golden: Array<{ strategy: StrategyKey; scenarioKey: string; value: unknown; previousValue?: unknown }> = [
  { strategy: 'STATE_GUARD', scenarioKey: 'device.status', value: 'OFFLINE', previousValue: 'ONLINE' },
  { strategy: 'EXPIRY_GUARD', scenarioKey: 'vehicle.insurance', value: '2026-09-20T00:00:00.000Z' },
  { strategy: 'ANOMALY_DETECTION', scenarioKey: 'finance.abnormal_transaction', value: 1200, previousValue: 100 },
  { strategy: 'SILENT_FOLLOW_UP', scenarioKey: 'finance.refund', value: 'COMPLETED', previousValue: 'PROCESSING' },
  { strategy: 'PERIODIC_SUMMARY', scenarioKey: 'work.email', value: ['mail-1', 'mail-2'] },
  { strategy: 'PREDICTIVE_PREPARE', scenarioKey: 'vehicle.maintenance', value: 20 },
  { strategy: 'ASSISTED_ACTION', scenarioKey: 'work.meetings', value: { title: '评审会' } },
  { strategy: 'AUTOMATED_ACTION', scenarioKey: 'device.status', value: 'HEALTHY' },
];

describe('strategy runtime foundation', () => {
  it('versions the complete deterministic operator registry', () => {
    expect(OPERATOR_REGISTRY.map((item) => item.key)).toEqual(CONDITION_OPERATORS_V1);
    expect(OPERATOR_REGISTRY).toHaveLength(17);
    expect(OPERATOR_REGISTRY.every((item) => item.revision === 1 && item.deterministic)).toBe(true);
  });

  it.each(golden)('compiles the $strategy golden scenario into one 15-step runtime', ({ strategy, scenarioKey, value, previousValue }) => {
    const compiled = compileScenarioPlan({ scenarioKey, strategy, subjectKey: `subject-${strategy}` });
    expect(compiled.runtime.strategy).toBe(strategy);
    expect(compiled.runtime.lifecycle).toEqual(PLAN_EXECUTION_LIFECYCLE.map((step) => ({ ...step, state: 'NOT_STARTED' })));
    expect(compiled.runtime.runtimeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(compiled.runtime.dependencies.some((dependency) => dependency.scope === (strategy === 'PERIODIC_SUMMARY' ? 'USER_AGGREGATE' : 'EXACT_SUBJECT'))).toBe(true);
    const factKey = compiled.runtime.dependencies[0]!.factKey;
    const decision = evaluateConditionAst(compiled.runtime.conditionAst, {
      evaluatedAt: '2026-09-09T00:00:00.000Z',
      facts: { [factKey]: { value, ...(previousValue !== undefined ? { previousValue } : {}), truthVersionId: `truth-${strategy}`, verifiedAt: '2026-09-08T00:00:00.000Z' } },
    });
    expect(decision.result).toBe(true);
    expect(decision.truthVersionIds).toEqual([`truth-${strategy}`]);
    expect(compiled.definition.schemaVersion).toBe('1.0');
  });

  it('evaluates nested ALL, ANY and NOT without free-text decisions', () => {
    const decision = evaluateConditionAst({
      kind: 'GROUP', operator: 'ALL', children: [
        { kind: 'PREDICATE', operator: 'GTE', factKey: 'balance.amount', comparisonValue: 100 },
        { kind: 'NOT', operator: 'NOT', child: { kind: 'PREDICATE', operator: 'IN', factKey: 'balance.status', comparisonValue: ['BLOCKED'] } },
        { kind: 'GROUP', operator: 'ANY', children: [
          { kind: 'PREDICATE', operator: 'CONTAINS', factKey: 'balance.tags', comparisonValue: 'verified' },
          { kind: 'PREDICATE', operator: 'EQ', factKey: 'balance.status', comparisonValue: 'HEALTHY' },
        ] },
      ],
    }, {
      evaluatedAt: '2026-09-09T00:00:00.000Z',
      facts: {
        'balance.amount': { value: 120, truthVersionId: 'v1', verifiedAt: '2026-09-09T00:00:00.000Z' },
        'balance.status': { value: 'HEALTHY', truthVersionId: 'v2', verifiedAt: '2026-09-09T00:00:00.000Z' },
        'balance.tags': { value: ['verified'], truthVersionId: 'v3', verifiedAt: '2026-09-09T00:00:00.000Z' },
      },
    });
    expect(decision.result).toBe(true);
    expect(decision.truthVersionIds).toEqual(['v1', 'v2', 'v3']);
    expect(decision.trace.at(-1)).toMatchObject({ path: 'root', operator: 'ALL', result: true });
  });
});
