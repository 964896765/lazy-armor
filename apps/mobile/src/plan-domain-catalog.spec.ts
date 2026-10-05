import { describe, expect, it } from 'vitest';
import { PLAN_DOMAIN_CATALOG, catalogTemplateCount } from '../../../packages/plan-schema/src/product-catalog';
import { coreTemplateIntent } from './plan-domain-catalog';

describe('plan domain catalog', () => {
  it('contains the complete 13-domain product taxonomy in display order', () => {
    expect(PLAN_DOMAIN_CATALOG.map((domain) => domain.label)).toEqual(['日常', '生活', '家庭', '健康', '财务', '工作', '学习', '信息', '出行', '人际', '兴趣', '资产', '事务']);
    expect(PLAN_DOMAIN_CATALOG.map(catalogTemplateCount)).toEqual([8, 8, 9, 8, 10, 9, 8, 8, 9, 7, 8, 8, 8]);
    expect(PLAN_DOMAIN_CATALOG.reduce((total, domain) => total + catalogTemplateCount(domain), 0)).toBe(108);
  });

  it('does not repeat a template within one domain', () => {
    for (const domain of PLAN_DOMAIN_CATALOG) {
      const templates = domain.groups.flatMap((group) => group.templates);
      expect(new Set(templates).size, domain.label).toBe(templates.length);
    }
  });

  it('preserves the selected category and merged problem in the AI handoff', () => {
    const domain = PLAN_DOMAIN_CATALOG.find(item => item.key === 'work')!;
    expect(domain.groups.flatMap(group => group.templates)).toContain('会议管理');
    expect(coreTemplateIntent(domain, '会议管理')).toContain('「工作」领域的「会议管理」');
    expect(coreTemplateIntent(domain, '会议管理')).toContain('未经确认不要执行操作');
  });
});
