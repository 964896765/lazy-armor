import { describe, expect, it } from 'vitest';
import { CANONICAL_SCENARIOS, PLAN_EXECUTION_LIFECYCLE, PLAN_STRATEGIES, PRODUCT_DOMAINS, productDomainFromStorageKey, scenariosForDomain } from '../src';

describe('stable Lazy Armor product model', () => {
  it('freezes the four independent product dimensions', () => {
    expect(PRODUCT_DOMAINS).toHaveLength(19);
    expect(CANONICAL_SCENARIOS).toHaveLength(96);
    expect(PLAN_STRATEGIES).toHaveLength(8);
    expect(PLAN_EXECUTION_LIFECYCLE).toHaveLength(15);
  });

  it('assigns every scenario to exactly one known domain', () => {
    const domains = new Set(PRODUCT_DOMAINS.map((domain) => domain.key));
    expect(CANONICAL_SCENARIOS.every((scenario) => domains.has(scenario.domain))).toBe(true);
    expect(new Set(CANONICAL_SCENARIOS.map((scenario) => `${scenario.domain}:${scenario.key}`)).size).toBe(96);
  });

  it('keeps the historical life storage key compatible with daily_life', () => {
    expect(productDomainFromStorageKey('life')?.key).toBe('daily_life');
    expect(scenariosForDomain('life')).toHaveLength(5);
    expect(scenariosForDomain('vehicle')).toHaveLength(6);
  });
});
