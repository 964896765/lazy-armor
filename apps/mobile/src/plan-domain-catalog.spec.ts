import { describe, expect, it } from 'vitest';
import { PLAN_DOMAIN_CATALOG, catalogTemplateCount } from './plan-domain-catalog';

describe('plan domain catalog', () => {
  it('contains the complete 13-domain product taxonomy in display order', () => {
    expect(PLAN_DOMAIN_CATALOG.map((domain) => domain.label)).toEqual(['日常', '生活', '家庭', '健康', '财务', '工作', '学习', '信息', '出行', '人际', '兴趣', '资产', '事务']);
    expect(PLAN_DOMAIN_CATALOG.map(catalogTemplateCount)).toEqual([15, 16, 20, 19, 23, 19, 16, 17, 19, 15, 20, 16, 16]);
    expect(PLAN_DOMAIN_CATALOG.reduce((total, domain) => total + catalogTemplateCount(domain), 0)).toBe(231);
  });

  it('does not repeat a template within one domain', () => {
    for (const domain of PLAN_DOMAIN_CATALOG) {
      const templates = domain.groups.flatMap((group) => group.templates);
      expect(new Set(templates).size, domain.label).toBe(templates.length);
    }
  });
});
