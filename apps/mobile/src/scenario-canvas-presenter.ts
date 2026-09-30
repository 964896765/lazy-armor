import { CANONICAL_DOMAIN_CATALOG, scenariosForDomain } from '@lazy-armor/plan-schema/mobile';
import { UI_SPACES, uiSpaceForDomain, type UiSpaceKey } from './ui-space';

export type SpaceFilter = UiSpaceKey | 'all';

export const SPACE_FILTERS: readonly { key: SpaceFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  ...UI_SPACES.map((space) => ({ key: space.key as SpaceFilter, label: space.label })),
];

export interface ScenarioRow {
  /** short scenario key, e.g. `delivery` */
  key: string;
  label: string;
  /** product domain key used in the scenario API key, e.g. `daily_life` */
  productDomain: string;
}

export interface ScenarioSection {
  domainKey: string;
  title: string;
  icon: string;
  data: ScenarioRow[];
}

const DOMAIN_ICONS: Record<string, string> = {
  finance: 'wallet-outline', daily_life: 'basket-outline', life: 'basket-outline', family: 'people-outline',
  health: 'heart-outline', social: 'chatbubbles-outline', pet: 'paw-outline', housing: 'home-outline',
  travel: 'airplane-outline', entertainment: 'game-controller-outline', work: 'briefcase-outline',
  operations: 'analytics-outline', content: 'create-outline', study: 'school-outline',
  identity_docs: 'id-card-outline', government: 'business-outline', legal_contract: 'document-text-outline',
  vehicle: 'car-outline', device: 'desktop-outline', digital_account: 'key-outline',
};

export function scenarioKeyOf(row: ScenarioRow): string { return `${row.productDomain}.${row.key}`; }

export function scenarioStateLabel(row: ScenarioRow, planCount: number): string {
  return planCount > 0 ? `${planCount} 个计划` : '查看状态';
}

export function buildScenarioSections(input: { space: SpaceFilter; query: string }): ScenarioSection[] {
  const q = input.query.trim().toLowerCase();
  const domains = CANONICAL_DOMAIN_CATALOG.filter((domain) => input.space === 'all' || uiSpaceForDomain(domain.key) === input.space);
  return domains.map((domain) => {
    const icon = DOMAIN_ICONS[domain.key] ?? 'grid-outline';
    const data = scenariosForDomain(domain.key)
      .filter((scenario) => !q || scenario.label.toLowerCase().includes(q) || scenario.key.toLowerCase().includes(q))
      .map((scenario) => ({ key: scenario.key, label: scenario.label, productDomain: scenario.domain }));
    return { domainKey: domain.key, title: domain.label, icon, data };
  }).filter((section) => section.data.length > 0);
}

export const TOTAL_SCENARIO_COUNT = CANONICAL_DOMAIN_CATALOG.reduce((sum, domain) => sum + scenariosForDomain(domain.key).length, 0);
