export interface HomeRecentPlan {
  planId: string;
  planName: string | null;
  planStatus: string;
  latestExecutionId: string | null;
  executionStatus: string | null;
  resultSummary: string | null;
  lastActivityAt: string | null;
  needsUserAction: boolean;
  consumerOutcome: {
    outcome: 'SUCCESS' | 'FAILED' | 'PENDING_CONFIRMATION' | 'OUTCOME_UNKNOWN' | null;
    reason?: string | null;
  };
}

export interface RunningPlanPresentation {
  label: string;
  tone: 'success' | 'warning' | 'muted';
  summary: string;
}

export const HOME_DATA_BOUNDARY = '来自服务端最近计划投影；服务端未提供触发阶段、来源新鲜度或权威下一步时，本页不会自行推断。';

const MANAGED_PLAN_STATES = new Set(['active', 'degraded', 'blocked']);

export function selectRunningPlanCards(plans: readonly HomeRecentPlan[]): HomeRecentPlan[] {
  return plans.filter((plan) => MANAGED_PLAN_STATES.has(plan.planStatus)).slice(0, 3);
}

export function presentRunningPlan(plan: HomeRecentPlan): RunningPlanPresentation {
  const outcome = plan.consumerOutcome.outcome;
  if (outcome === 'PENDING_CONFIRMATION') return presentation('等待确认', 'warning', plan, '服务端显示这条计划正在等待用户确认。');
  if (outcome === 'OUTCOME_UNKNOWN') return presentation('结果待核实', 'warning', plan, '服务端尚未确认这次执行的真实结果。');
  if (outcome === 'FAILED') return presentation('最近一次未完成', 'warning', plan, '服务端记录最近一次执行未完成。');
  if (plan.executionStatus === 'running') return presentation('正在执行', 'success', plan, '服务端记录当前存在正在执行的任务。');
  if (plan.executionStatus === 'waiting_approval') return presentation('等待审批/确认', 'warning', plan, '服务端记录当前执行正在等待审批。');
  if (['created', 'queued', 'waiting_dispatch'].includes(plan.executionStatus ?? '')) {
    return presentation('等待执行', 'muted', plan, '服务端已建立执行记录，尚未进入执行。');
  }
  if (plan.planStatus === 'degraded') return presentation('数据或来源需检查', 'warning', plan, '服务端将这条计划标记为降级状态。');
  if (plan.planStatus === 'blocked') return presentation('计划受阻', 'warning', plan, '服务端将这条计划标记为受阻状态。');
  return presentation('持续跟进', 'success', plan, '服务端显示计划已启用；这不代表此刻存在执行任务。');
}

function presentation(label: string, tone: RunningPlanPresentation['tone'], plan: HomeRecentPlan, fallback: string): RunningPlanPresentation {
  return {
    label,
    tone,
    summary: plan.consumerOutcome.reason?.trim() || plan.resultSummary?.trim() || fallback,
  };
}

// V6.0 四大空间与 19 领域场景树的统一映射已下沉到 ui-space.ts，供首页与
// 计划中心共享，避免在页面里重复硬编码。这里保留历史别名以兼容现有调用方。
export {
  UI_SPACE_KEYS,
  UI_SPACES as HOME_SPACES,
  uiSpaceDefinition,
  uiSpaceForDomain,
  uiDomainsForSpace as homeDomainsForSpace,
  allUiDomainKeys as allHomeDomainKeys,
  type UiSpaceKey as HomeSpaceKey,
  type UiDomainNode as HomeDomainNode,
} from './ui-space';
