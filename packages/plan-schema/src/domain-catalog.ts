export const CANONICAL_PLAN_DOMAINS = [
  'finance',
  'life',
  'family',
  'health',
  'social',
  'pet',
  'housing',
  'travel',
  'entertainment',
  'work',
  'operations',
  'content',
  'study',
  'identity_docs',
  'government',
  'legal_contract',
  'vehicle',
  'device',
  'digital_account',
] as const;

export const LEGACY_PLAN_DOMAINS = ['general', 'billing', 'shopping'] as const;
export const PLAN_DOMAINS = [...CANONICAL_PLAN_DOMAINS, ...LEGACY_PLAN_DOMAINS] as const;

export type CanonicalPlanDomain = typeof CANONICAL_PLAN_DOMAINS[number];
export type LegacyPlanDomain = typeof LEGACY_PLAN_DOMAINS[number];
export type PlanDomain = typeof PLAN_DOMAINS[number];
export type DomainGroupKey = 'money' | 'life' | 'things' | 'work';

export interface CanonicalDomainDefinition {
  key: CanonicalPlanDomain;
  label: string;
  group: DomainGroupKey;
}

export const DOMAIN_GROUPS: Readonly<Record<DomainGroupKey, { label: string; description: string }>> = Object.freeze({
  money: { label: '我的钱', description: '财务、账单和需要留意的金额变化' },
  life: { label: '我的生活', description: '日常、家人、健康、出行和居住安排' },
  work: { label: '我的事情', description: '工作、学习、内容和需要推进的事务' },
  things: { label: '我的物品', description: '车辆、设备和数字账号等长期资产' },
});

export const CANONICAL_DOMAIN_CATALOG: readonly CanonicalDomainDefinition[] = Object.freeze([
  { key: 'finance', label: '财务', group: 'money' },
  { key: 'life', label: '生活', group: 'life' },
  { key: 'family', label: '家庭', group: 'life' },
  { key: 'health', label: '健康', group: 'life' },
  { key: 'social', label: '社交关系', group: 'life' },
  { key: 'pet', label: '宠物', group: 'life' },
  { key: 'housing', label: '住房', group: 'life' },
  { key: 'travel', label: '出行', group: 'life' },
  { key: 'entertainment', label: '娱乐', group: 'life' },
  { key: 'work', label: '工作', group: 'work' },
  { key: 'operations', label: '运营', group: 'work' },
  { key: 'content', label: '内容', group: 'work' },
  { key: 'study', label: '学习', group: 'work' },
  { key: 'identity_docs', label: '证件事务', group: 'work' },
  { key: 'government', label: '政务事务', group: 'work' },
  { key: 'legal_contract', label: '合同法律', group: 'work' },
  { key: 'vehicle', label: '车辆', group: 'things' },
  { key: 'device', label: '设备', group: 'things' },
  { key: 'digital_account', label: '数字账号', group: 'things' },
]);

const LEGACY_DOMAIN_ALIASES: Readonly<Record<LegacyPlanDomain, CanonicalPlanDomain>> = Object.freeze({
  general: 'life',
  billing: 'finance',
  shopping: 'life',
});

const canonicalDomainKeys = new Set<string>(CANONICAL_PLAN_DOMAINS);
const catalogByKey = new Map<CanonicalPlanDomain, CanonicalDomainDefinition>(CANONICAL_DOMAIN_CATALOG.map((domain) => [domain.key, domain]));

/**
 * Maps a stored historical domain to its presentation catalog domain without mutating
 * the stored PlanVersion definition or its canonical hash.
 */
export function canonicalPlanDomain(domain: string | null | undefined): CanonicalPlanDomain | null {
  if (!domain) return null;
  if (domain in LEGACY_DOMAIN_ALIASES) return LEGACY_DOMAIN_ALIASES[domain as LegacyPlanDomain];
  return canonicalDomainKeys.has(domain) ? domain as CanonicalPlanDomain : null;
}

export function domainDefinition(domain: string | null | undefined): CanonicalDomainDefinition | null {
  const canonical = canonicalPlanDomain(domain);
  return canonical ? catalogByKey.get(canonical) ?? null : null;
}

export function domainGroupFor(domain: string | null | undefined): DomainGroupKey | null {
  return domainDefinition(domain)?.group ?? null;
}
