import { CANONICAL_DOMAIN_CATALOG } from '@lazy-armor/plan-schema/mobile';
import { describe, expect, it } from 'vitest';
import {
  UI_SPACES,
  allUiDomainKeys,
  uiDomainsForSpace,
  uiSpaceForDomain,
  type UiSpaceKey,
} from './ui-space';

describe('V6.0 unified UI space mapping', () => {
  it('defines exactly four consumer spaces with the confirmed labels', () => {
    expect(UI_SPACES.map((space) => space.key)).toEqual(['life', 'property', 'affairs', 'work']);
    expect(UI_SPACES.map((space) => space.label)).toEqual(['我的生活', '我的财物', '我的事务', '我的工作']);
  });

  it('assigns every canonical domain to exactly one space without duplication or orphans', () => {
    const keys = allUiDomainKeys();
    expect(keys).toHaveLength(19);
    expect(new Set(keys).size).toBe(19);
    expect(new Set(keys)).toEqual(new Set(CANONICAL_DOMAIN_CATALOG.map((domain) => domain.key)));
  });

  it('maps the confirmed V6.0 space boundaries', () => {
    expect(uiDomainsForSpace('life').map((node) => node.key)).toEqual(['life', 'family', 'health', 'social', 'pet', 'travel', 'entertainment']);
    expect(uiDomainsForSpace('property').map((node) => node.key)).toEqual(['finance', 'housing', 'vehicle', 'device', 'digital_account']);
    expect(uiDomainsForSpace('affairs').map((node) => node.key)).toEqual(['identity_docs', 'government', 'legal_contract']);
    expect(uiDomainsForSpace('work').map((node) => node.key)).toEqual(['work', 'operations', 'content', 'study']);
  });

  it('resolves every canonical domain back to its owning space', () => {
    for (const domain of CANONICAL_DOMAIN_CATALOG) {
      expect(uiSpaceForDomain(domain.key)).not.toBeNull();
    }
    expect(uiSpaceForDomain('unknown_domain')).toBeNull();
  });

  it('never mutates the 19 canonical domain keys or the 96-scenario identity', () => {
    // The mapping is purely presentational; canonical keys stay byte-identical.
    const joined = UI_SPACES.flatMap((space) => space.domainKeys).join(',');
    expect(joined).toContain('finance');
    expect(joined).toContain('identity_docs');
    expect(UI_SPACES.every((space) => !space.domainKeys.some((key) => !CANONICAL_DOMAIN_CATALOG.some((domain) => domain.key === key)))).toBe(true);
  });

  it('covers every space for the domain-tree presenter', () => {
    const all: UiSpaceKey[] = ['life', 'property', 'affairs', 'work'];
    for (const space of all) {
      expect(uiDomainsForSpace(space).length).toBeGreaterThan(0);
      expect(uiDomainsForSpace(space).every((node) => uiSpaceForDomain(node.key) === space)).toBe(true);
    }
  });
});
