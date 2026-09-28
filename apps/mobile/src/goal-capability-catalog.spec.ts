import { describe, expect, it } from 'vitest';
import { GOAL_CAPABILITIES, GOAL_CAPABILITY_CATEGORIES, GOAL_CAPABILITY_GROUPS } from './goal-capability-catalog';

describe('goal capability catalog', () => {
  it('keeps the governed 5 / 18 / 90 structure', () => {
    expect(GOAL_CAPABILITY_GROUPS).toHaveLength(5);
    expect(GOAL_CAPABILITY_CATEGORIES).toHaveLength(18);
    expect(GOAL_CAPABILITIES).toHaveLength(90);
  });

  it('uses unique stable keys and does not claim runtime availability', () => {
    expect(new Set(GOAL_CAPABILITIES.map((item) => item.key)).size).toBe(90);
    expect(GOAL_CAPABILITIES.every((item) => item.state === 'catalog_only')).toBe(true);
  });
});
