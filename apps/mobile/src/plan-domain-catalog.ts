export type { PlanDomainCatalog, PlanCatalogGroup } from '@lazy-armor/plan-schema';
import type { PlanDomainCatalog } from '@lazy-armor/plan-schema';
export function coreTemplateIntent(domain: PlanDomainCatalog, name: string) {
  return '我想创建「' + domain.label + '」领域的「' + name + '」计划。请先询问我的具体目标、范围、周期与已有资源，再个性化细化；未经确认不要执行操作。';
}
