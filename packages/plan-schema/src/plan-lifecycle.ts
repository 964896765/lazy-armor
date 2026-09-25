import { z } from 'zod';
import type { ConsumerReadinessProjection } from './consumer-projection';

export const PLAN_LIFECYCLE_PROJECTION_VERSION = 1 as const;

export const PLAN_LIFECYCLE_STEPS = Object.freeze([
  { step: 1, key: 'DOMAIN', label: '选择领域' },
  { step: 2, key: 'SCENARIO', label: '选择场景' },
  { step: 3, key: 'GOAL_OBJECT', label: '定义目标与对象' },
  { step: 4, key: 'REQUIREMENTS', label: '加载事实、动作与验证要求' },
  { step: 5, key: 'CAPABILITY_DISCOVERY', label: '发现来源与动作能力' },
  { step: 6, key: 'READINESS', label: '判断当前可兑现度' },
  { step: 7, key: 'PLAN_OFFERS', label: '生成可兑现方案' },
  { step: 8, key: 'RANK_EXPLAIN', label: '比较并解释方案' },
  { step: 9, key: 'USER_SELECTION', label: '用户选择方案与权限' },
  { step: 10, key: 'USER_PLAN', label: '固定计划版本' },
  { step: 11, key: 'TRUTH_REFRESH', label: '持续获取有效事实' },
  { step: 12, key: 'DECISION', label: '根据事实决定下一步' },
  { step: 13, key: 'RISK_POLICY_APPROVAL', label: '风险、策略与审批' },
  { step: 14, key: 'EXECUTION', label: '执行或交接' },
  { step: 15, key: 'VERIFICATION', label: '验证真实结果' },
  { step: 16, key: 'TODAY_RECORDS', label: '展示当前结果与历史' },
  { step: 17, key: 'AVAILABILITY_RECONCILIATION', label: '持续重算可用性' },
] as const);

export const PLAN_LIFECYCLE_STATES = [
  'NOT_REACHED', 'READY', 'ACTIVE', 'COMPLETED', 'BLOCKED', 'FAILED', 'OUTCOME_UNKNOWN', 'SKIPPED',
] as const;

export type PlanLifecycleStepKey = typeof PLAN_LIFECYCLE_STEPS[number]['key'];
export type PlanLifecycleState = typeof PLAN_LIFECYCLE_STATES[number];

export const planLifecycleObservationSchema = z.object({
  key: z.enum(PLAN_LIFECYCLE_STEPS.map((item) => item.key) as [PlanLifecycleStepKey, ...PlanLifecycleStepKey[]]),
  state: z.enum(PLAN_LIFECYCLE_STATES).exclude(['NOT_REACHED']),
  reasonCode: z.string().trim().min(1).max(120),
  evidenceRefs: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
}).strict();

export type PlanLifecycleObservation = z.infer<typeof planLifecycleObservationSchema>;

export interface PlanLifecycleProjection {
  contractVersion: typeof PLAN_LIFECYCLE_PROJECTION_VERSION;
  readOnly: true;
  subject: Readonly<{ planId: string; planVersionId: string | null; scenarioKey: string | null }>;
  readiness: ConsumerReadinessProjection | null;
  currentStep: number | null;
  steps: readonly Readonly<{
    step: number;
    key: PlanLifecycleStepKey;
    label: string;
    state: PlanLifecycleState;
    reasonCode: string | null;
    evidenceRefs: readonly string[];
  }>[];
  evaluatedAt: string;
}

export function buildPlanLifecycleProjection(input: {
  planId: string;
  planVersionId?: string | null;
  scenarioKey?: string | null;
  readiness?: ConsumerReadinessProjection | null;
  observations?: readonly PlanLifecycleObservation[];
  evaluatedAt: string;
}): PlanLifecycleProjection {
  const observations = new Map<PlanLifecycleStepKey, PlanLifecycleObservation>();
  for (const raw of input.observations ?? []) {
    const observation = planLifecycleObservationSchema.parse(raw);
    if (observations.has(observation.key)) throw new Error(`Duplicate plan lifecycle observation: ${observation.key}`);
    observations.set(observation.key, observation);
  }
  const steps = PLAN_LIFECYCLE_STEPS.map((definition) => {
    const observation = observations.get(definition.key);
    return Object.freeze({
      ...definition,
      state: observation?.state ?? 'NOT_REACHED' as PlanLifecycleState,
      reasonCode: observation?.reasonCode ?? null,
      evidenceRefs: Object.freeze([...(observation?.evidenceRefs ?? [])]),
    });
  });
  const current = steps.find((item) => item.state === 'ACTIVE' || item.state === 'BLOCKED'
    || item.state === 'FAILED' || item.state === 'OUTCOME_UNKNOWN')
    ?? steps.find((item) => item.state === 'READY' || item.state === 'NOT_REACHED');
  return Object.freeze({
    contractVersion: PLAN_LIFECYCLE_PROJECTION_VERSION,
    readOnly: true as const,
    subject: Object.freeze({
      planId: input.planId,
      planVersionId: input.planVersionId ?? null,
      scenarioKey: input.scenarioKey ?? null,
    }),
    readiness: input.readiness ?? null,
    currentStep: current?.step ?? null,
    steps: Object.freeze(steps),
    evaluatedAt: input.evaluatedAt,
  });
}

export function isPlanLifecycleProjection(value: unknown): value is PlanLifecycleProjection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlanLifecycleProjection>;
  return candidate.contractVersion === PLAN_LIFECYCLE_PROJECTION_VERSION
    && candidate.readOnly === true
    && typeof candidate.subject?.planId === 'string'
    && typeof candidate.evaluatedAt === 'string'
    && Array.isArray(candidate.steps)
    && candidate.steps.length === PLAN_LIFECYCLE_STEPS.length
    && candidate.steps.every((item, index) => item.step === index + 1
      && item.key === PLAN_LIFECYCLE_STEPS[index]?.key
      && PLAN_LIFECYCLE_STATES.includes(item.state));
}
