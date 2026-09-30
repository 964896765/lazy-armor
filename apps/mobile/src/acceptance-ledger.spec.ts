import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_STATES,
  ALL_ACCEPTANCE_ITEMS,
  ANDROID_ACCEPTANCE_ITEMS,
  PROVIDER_ACCEPTANCE_ITEMS,
  acceptanceComplete,
  pendingAcceptanceCount,
} from './acceptance-ledger';

describe('acceptance ledger', () => {
  it('records Android and Provider acceptance items as pending until real evidence', () => {
    expect(ANDROID_ACCEPTANCE_ITEMS.length).toBeGreaterThanOrEqual(8);
    expect(PROVIDER_ACCEPTANCE_ITEMS.length).toBeGreaterThanOrEqual(7);
    expect(ALL_ACCEPTANCE_ITEMS.every((item) => item.state === 'EXTERNAL_ACCEPTANCE_PENDING')).toBe(true);
    expect(acceptanceComplete()).toBe(false);
  });

  it('has unique, stable ids and non-empty evidence requirements', () => {
    const ids = ALL_ACCEPTANCE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ALL_ACCEPTANCE_ITEMS) {
      expect(item.capability.trim().length).toBeGreaterThan(0);
      expect(item.evidenceRequired.trim().length).toBeGreaterThan(0);
      expect(ACCEPTANCE_STATES).toContain(item.state);
    }
  });

  it('counts pending items consistently with the item list', () => {
    expect(pendingAcceptanceCount()).toBe(ALL_ACCEPTANCE_ITEMS.length);
  });
});
