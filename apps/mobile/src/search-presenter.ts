import { executionStatusLabel } from './execution-presenter';

export interface SearchPlanHit {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
}

export interface SearchScenarioHit {
  key: string;
  domain: string;
  label: string;
}

export interface SearchExecutionHit {
  id: string;
  planId: string;
  planName: string | null;
  status: string;
  resultSummary: string | null;
  createdAt: string;
}

export interface SearchNotificationHit {
  id: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface SearchResults {
  plans: SearchPlanHit[];
  scenarios: SearchScenarioHit[];
  executions: SearchExecutionHit[];
  notifications: SearchNotificationHit[];
}

export interface SearchRow {
  id: string;
  title: string;
  subtitle: string;
  route: string;
}

export type SearchSectionKey = 'plans' | 'scenarios' | 'executions' | 'notifications';

export interface SearchSection {
  key: SearchSectionKey;
  title: string;
  rows: SearchRow[];
}

const SECTION_TITLES: Record<SearchSectionKey, string> = {
  plans: '我的计划',
  scenarios: '相关场景',
  executions: '执行记录',
  notifications: '消息',
};

/** Map the grouped `/search` response into display sections with navigation routes. */
export function buildSearchSections(results: SearchResults | undefined): SearchSection[] {
  if (!results) return [];
  const sections: SearchSection[] = [
    {
      key: 'plans',
      title: SECTION_TITLES.plans,
      rows: results.plans.map((plan) => ({
        id: `plan:${plan.id}`,
        title: plan.name ?? '未命名计划',
        subtitle: plan.description ?? '',
        route: `/plans/${plan.id}`,
      })),
    },
    {
      key: 'scenarios',
      title: SECTION_TITLES.scenarios,
      rows: results.scenarios.map((scenario) => ({
        id: `scenario:${scenario.domain}.${scenario.key}`,
        title: scenario.label,
        subtitle: `${scenario.domain}.${scenario.key}`,
        route: `/domains/${scenario.domain}/${scenario.key}`,
      })),
    },
    {
      key: 'executions',
      title: SECTION_TITLES.executions,
      rows: results.executions.map((execution) => ({
        id: `execution:${execution.id}`,
        title: execution.resultSummary ?? executionStatusLabel(execution.status),
        subtitle: [execution.planName, executionStatusLabel(execution.status)].filter(Boolean).join(' · '),
        route: `/executions/${execution.id}`,
      })),
    },
    {
      key: 'notifications',
      title: SECTION_TITLES.notifications,
      rows: results.notifications.map((notification) => ({
        id: `notification:${notification.id}`,
        title: notification.title,
        subtitle: notification.body,
        route: '/(tabs)/messages',
      })),
    },
  ];
  return sections.filter((section) => section.rows.length > 0);
}

/** Label always shown alongside any AI output: deterministic fixture, not a real model. */
export const AI_DEMO_NOTICE = '演示能力（未接真实模型，仅确定性夹具）';

export type AiResponseKind = 'ANSWER' | 'PLAN_DRAFT' | 'CLARIFICATION_REQUIRED' | 'UNAVAILABLE';

export interface AiResponse {
  kind: AiResponseKind;
  title: string;
  body: string | null;
  missingRequirements: string[];
  scenarioKey: string | null;
}

export interface PlannerResultLike {
  result?: string;
  answer?: { explanation?: string } | null;
  proposal?: { explanation?: string; scenarioKey?: string | null } | null;
  clarification?: { missingRequirements?: string[] } | null;
}

/** Map the agent planner result into display content without fabricating plan state. */
export function buildAiResponse(plan: PlannerResultLike | undefined): AiResponse {
  if (plan?.result === 'ANSWER' && plan.answer?.explanation) {
    return { kind: 'ANSWER', title: '回答', body: plan.answer.explanation, missingRequirements: [], scenarioKey: null };
  }
  if (plan?.result === 'PLAN_DRAFT' && plan.proposal) {
    return {
      kind: 'PLAN_DRAFT',
      title: '计划草稿',
      body: plan.proposal.explanation ?? null,
      missingRequirements: [],
      scenarioKey: plan.proposal.scenarioKey ?? null,
    };
  }
  if (plan?.result === 'CLARIFICATION_REQUIRED' && plan.clarification) {
    return {
      kind: 'CLARIFICATION_REQUIRED',
      title: '需要补充信息',
      body: null,
      missingRequirements: plan.clarification.missingRequirements ?? [],
      scenarioKey: null,
    };
  }
  return { kind: 'UNAVAILABLE', title: 'AI 暂不可用', body: AI_DEMO_NOTICE, missingRequirements: [], scenarioKey: null };
}
