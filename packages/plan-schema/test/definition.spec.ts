import { describe, expect, it } from 'vitest';
import { definitionHash, normalizePlanDefinition } from '../src';

const demo = {
  name: '话费守护',
  domain: 'billing' as const,
  automationLevel: 'L1' as const,
  sources: [{ sourceType: 'manual' as const, config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual' as const, config: {}, sortOrder: 0 }],
  conditions: [{ fieldPath: 'amount', operator: 'GT' as const, comparisonValue: 150, sortOrder: 0 }],
  actions: [{ actionType: 'notify' as const, config: {}, stepOrder: 0 }],
};

describe('PlanDefinition canonicalization', () => {
  it('produces a stable hash for equivalent input', () => {
    const left = normalizePlanDefinition(demo);
    const right = normalizePlanDefinition({ ...demo, sources: [{ sortOrder: 0, config: {}, sourceType: 'manual' }] });
    expect(definitionHash(left)).toBe(definitionHash(right));
  });

  it('changes the hash when a rule changes', () => {
    const v1 = normalizePlanDefinition(demo);
    const v2 = normalizePlanDefinition({ ...demo, conditions: [{ ...demo.conditions[0]!, comparisonValue: 200 }] });
    expect(definitionHash(v1)).not.toBe(definitionHash(v2));
  });

  it('rejects arbitrary config keys and unsupported operators', () => {
    expect(() => normalizePlanDefinition({ ...demo, sources: [{ sourceType: 'manual', config: { script: 'eval(1)' }, sortOrder: 0 }] })).toThrow();
    expect(() => normalizePlanDefinition({ ...demo, conditions: [{ fieldPath: 'amount', operator: 'EVAL' as never, comparisonValue: 1, sortOrder: 0 }] })).toThrow();
  });
});
