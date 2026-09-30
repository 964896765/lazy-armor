import { UI_SPACES, uiDomainsForSpace, type UiSpaceKey } from './ui-space';

/** Space is presentation grouping only; scenario and plan identity stay on the server. */
export interface SpaceDirectoryItem {
  key: UiSpaceKey;
  label: string;
  description: string;
  domains: ReadonlyArray<{ key: string; label: string; scenarioCount: number }>;
}

export function buildSpaceDirectory(): readonly SpaceDirectoryItem[] {
  return UI_SPACES.map((space) => ({
    key: space.key,
    label: space.label,
    description: space.description,
    domains: uiDomainsForSpace(space.key).map((domain) => ({
      key: domain.key,
      label: domain.label,
      scenarioCount: domain.scenarios.length,
    })),
  }));
}
