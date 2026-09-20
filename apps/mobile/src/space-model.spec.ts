import { describe, expect, it } from 'vitest';
import { CANONICAL_DOMAIN_CATALOG, CANONICAL_SCENARIOS } from '@lazy-armor/plan-schema/mobile';
import { buildSpaceDirectory } from './space-model';

describe('space directory', () => {
  it('groups the existing catalog without inventing a fifth runtime domain', () => {
    const spaces = buildSpaceDirectory();
    expect(spaces.map((space) => space.label)).toEqual(['我的钱', '我的生活', '我的事情', '我的物品']);
    expect(spaces.flatMap((space) => space.domains.map((domain) => domain.key)).sort())
      .toEqual(CANONICAL_DOMAIN_CATALOG.map((domain) => domain.key).sort());
    expect(spaces.reduce((count, space) => count + space.domains.reduce((sum, domain) => sum + domain.scenarioCount, 0), 0))
      .toBe(CANONICAL_SCENARIOS.length);
  });
});
