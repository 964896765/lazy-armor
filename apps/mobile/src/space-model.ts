import { CANONICAL_DOMAIN_CATALOG, DOMAIN_GROUPS, scenariosForDomain, type DomainGroupKey } from '@lazy-armor/plan-schema/mobile';

/** Space is presentation grouping only; scenario and plan identity stay on the server. */
const SPACE_ORDER: readonly DomainGroupKey[] = ['money', 'life', 'work', 'things'];

export interface SpaceDirectoryItem {
  key: DomainGroupKey;
  label: string;
  description: string;
  domains: ReadonlyArray<{ key: string; label: string; scenarioCount: number }>;
}

export function buildSpaceDirectory(): readonly SpaceDirectoryItem[] {
  return SPACE_ORDER.map((key) => ({
    key,
    label: DOMAIN_GROUPS[key].label,
    description: DOMAIN_GROUPS[key].description,
    domains: CANONICAL_DOMAIN_CATALOG
      .filter((domain) => domain.group === key)
      .map((domain) => ({ key: domain.key, label: domain.label, scenarioCount: scenariosForDomain(domain.key).length })),
  }));
}
