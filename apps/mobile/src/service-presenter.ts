export type ServiceSection = 'recommended' | 'following' | 'nearby' | 'active';
export type ServiceKind = 'all' | 'plan' | 'service' | 'supply';

export interface ServicePlanProjection {
  id: string;
  status: string;
  name: string | null;
  templateKey: string | null;
  currentVersion: { name: string; domain: string } | null;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
}

export interface PresentedServicePlan {
  id: string;
  title: string;
  summary: string;
  kind: Exclude<ServiceKind, 'all'>;
  kindLabel: string;
  statusLabel: string;
  actionLabel: string;
}

const SUPPLY_HINT = /supply|supplies|consumable|inventory|补给|耗材|库存|采购清单/i;
const SERVICE_HINT = /service|maintenance|repair|clean|care|保养|维修|清洁|照护|安装|整理/i;
const ACTIVE_PLAN_STATUSES = new Set(['active', 'running', 'paused']);
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'pending', 'waiting_approval']);

export function serviceKind(plan: ServicePlanProjection): PresentedServicePlan['kind'] {
  const source = [plan.templateKey, plan.name, plan.currentVersion?.name].filter(Boolean).join(' ');
  if (SUPPLY_HINT.test(source)) return 'supply';
  if (SERVICE_HINT.test(source)) return 'service';
  return 'plan';
}

export function presentServicePlan(plan: ServicePlanProjection): PresentedServicePlan {
  const kind = serviceKind(plan);
  return {
    id: plan.id,
    title: plan.name ?? plan.currentVersion?.name ?? '未命名计划',
    summary: plan.latestExecution?.resultSummary ?? '服务端尚未记录最新执行结果。',
    kind,
    kindLabel: kind === 'supply' ? '补给' : kind === 'service' ? '服务' : '方案',
    statusLabel: statusLabel(plan),
    actionLabel: kind === 'plan' ? '查看方案' : '查看计划',
  };
}

export function filterServicePlans(
  plans: readonly ServicePlanProjection[],
  section: ServiceSection,
  query: string,
  kind: ServiceKind,
): PresentedServicePlan[] {
  if (section === 'following' || section === 'nearby') return [];
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  return plans
    .filter((plan) => section !== 'active' || isActive(plan))
    .map(presentServicePlan)
    .filter((plan) => kind === 'all' || plan.kind === kind)
    .filter((plan) => !normalized || `${plan.title} ${plan.summary} ${plan.kindLabel}`.toLocaleLowerCase('zh-CN').includes(normalized));
}

function isActive(plan: ServicePlanProjection): boolean {
  return ACTIVE_PLAN_STATUSES.has(plan.status.toLowerCase())
    || ACTIVE_EXECUTION_STATUSES.has(plan.latestExecution?.status.toLowerCase() ?? '');
}

function statusLabel(plan: ServicePlanProjection): string {
  const executionStatus = plan.latestExecution?.status.toLowerCase();
  if (executionStatus === 'waiting_approval' || executionStatus === 'pending') return '等待确认';
  if (executionStatus === 'running' || executionStatus === 'queued') return '处理中';
  if (executionStatus === 'failed') return '需要处理';
  switch (plan.status.toLowerCase()) {
    case 'active':
    case 'running': return '计划进行中';
    case 'paused': return '计划已暂停';
    case 'failed': return '需要处理';
    default: return '查看计划';
  }
}
