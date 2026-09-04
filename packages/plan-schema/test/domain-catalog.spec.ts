import { describe, expect, it } from 'vitest';
import {
  CANONICAL_DOMAIN_CATALOG,
  CANONICAL_PLAN_DOMAINS,
  canonicalPlanDomain,
  definitionHash,
  domainDefinition,
  domainGroupFor,
  normalizePlanDefinition,
} from '../src';

const baseDefinition = {
  name: '领域兼容测试',
  automationLevel: 'L1' as const,
  sources: [{ sourceType: 'manual' as const, config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual' as const, config: {}, sortOrder: 0 }],
  conditions: [],
  actions: [{ actionType: 'notify' as const, config: {}, stepOrder: 0 }],
};

describe('canonical domain catalog', () => {
  it('defines exactly nineteen canonical domains across the four consumer spaces', () => {
    expect(CANONICAL_PLAN_DOMAINS).toHaveLength(19);
    expect(CANONICAL_DOMAIN_CATALOG.map((domain) => domain.key)).toEqual(CANONICAL_PLAN_DOMAINS);
    expect(new Set(CANONICAL_DOMAIN_CATALOG.map((domain) => domain.group))).toEqual(new Set(['money', 'life', 'work', 'things']));
  });

  it('accepts every canonical domain for newly created definitions', () => {
    for (const domain of CANONICAL_PLAN_DOMAINS) {
      expect(normalizePlanDefinition({ ...baseDefinition, domain }).domain).toBe(domain);
    }
  });

  it('keeps historical stored domains parseable without rewriting their definition hash', () => {
    const historical = normalizePlanDefinition({ ...baseDefinition, domain: 'billing' });
    const sameHistoricalValue = normalizePlanDefinition({ ...baseDefinition, domain: 'billing' });
    expect(definitionHash(historical)).toBe(definitionHash(sameHistoricalValue));
    expect(historical.domain).toBe('billing');
    expect(canonicalPlanDomain(historical.domain)).toBe('finance');
  });

  it('maps all legacy values to a safe presentation domain without manufacturing unknown domains', () => {
    expect(domainDefinition('general')).toMatchObject({ key: 'life', group: 'life' });
    expect(domainDefinition('billing')).toMatchObject({ key: 'finance', group: 'money' });
    expect(domainGroupFor('shopping')).toBe('life');
    expect(canonicalPlanDomain('unknown_domain')).toBeNull();
  });
});
