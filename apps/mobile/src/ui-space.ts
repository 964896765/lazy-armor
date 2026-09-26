import { CANONICAL_DOMAIN_CATALOG, scenariosForDomain } from '@lazy-armor/plan-schema/mobile';

/**
 * V6.0 统一展示空间（UiSpaceKey）。
 *
 * 与 plan-schema 的历史 DomainGroupKey（money/life/work/things）解耦：
 * - 不修改 19 领域的 canonical key；
 * - 不修改 96 场景的身份、版本或 hash；
 * - 不修改历史 PlanVersion 的 domain 字段。
 *
 * 这里只是「展示分组」。首页与计划中心共享这一份映射，禁止在页面里重复硬编码。
 */
export const UI_SPACE_KEYS = ['life', 'property', 'affairs', 'work'] as const;
export type UiSpaceKey = typeof UI_SPACE_KEYS[number];

export interface UiSpaceDefinition {
  key: UiSpaceKey;
  label: string;
  description: string;
  /** 每个领域归属且仅归属一个空间；顺序即展示顺序。 */
  domainKeys: readonly string[];
}

export const UI_SPACES: readonly UiSpaceDefinition[] = [
  { key: 'life', label: '我的生活', description: '日常、家人、健康、出行和社交安排', domainKeys: ['life', 'family', 'health', 'social', 'pet', 'travel', 'entertainment'] },
  { key: 'property', label: '我的财物', description: '财务、住房、车辆、设备和数字账号等资产', domainKeys: ['finance', 'housing', 'vehicle', 'device', 'digital_account'] },
  { key: 'affairs', label: '我的事务', description: '证件、政务、合同与法律事务', domainKeys: ['identity_docs', 'government', 'legal_contract'] },
  { key: 'work', label: '我的工作', description: '工作、运营、内容创作和学习', domainKeys: ['work', 'operations', 'content', 'study'] },
];

const DOMAIN_SPACE_BY_KEY: ReadonlyMap<string, UiSpaceKey> = new Map(
  UI_SPACES.flatMap((space) => space.domainKeys.map((domainKey) => [domainKey, space.key])),
);

export function uiSpaceDefinition(key: UiSpaceKey): UiSpaceDefinition {
  const space = UI_SPACES.find((item) => item.key === key);
  if (!space) throw new Error(`Unknown UiSpaceKey: ${key}`);
  return space;
}

export function uiSpaceForDomain(domainKey: string): UiSpaceKey | null {
  return DOMAIN_SPACE_BY_KEY.get(domainKey) ?? null;
}

export interface UiDomainNode {
  key: string;
  label: string;
  scenarios: readonly { key: string; label: string; productDomain: string }[];
}

export function uiDomainsForSpace(space: UiSpaceKey): readonly UiDomainNode[] {
  const definition = uiSpaceDefinition(space);
  return definition.domainKeys.map((key) => {
    const domain = CANONICAL_DOMAIN_CATALOG.find((item) => item.key === key);
    if (!domain) throw new Error(`Canonical domain is missing: ${key}`);
    return {
      key: domain.key,
      label: domain.label,
      scenarios: scenariosForDomain(domain.key).map((scenario) => ({
        key: scenario.key,
        label: scenario.label,
        productDomain: scenario.domain,
      })),
    };
  });
}

/** 全部空间的领域 key 展开（用于完整性校验，避免遗漏或重复）。 */
export function allUiDomainKeys(): string[] {
  return UI_SPACES.flatMap((space) => [...space.domainKeys]);
}
