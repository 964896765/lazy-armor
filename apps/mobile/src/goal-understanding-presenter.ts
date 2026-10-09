import { goalUnderstandingSchema } from '@lazy-armor/plan-schema/mobile';
import { ConsumerPresentationMapper as presentation } from './consumer-presentation';

const lifecycleLabels = { TEMPORARY: '本次处理', USER_EVENT: '个人事项', PERSISTENT: '持续计划' };
const stepLabels = {
  CONFIRM: '确认方案', SAVE_EVENT: '保存内部事项', ACQUIRE: '读取所需信息', ASSESS: '判断下一步',
  EXECUTE: '按权限与审批处理', VERIFY: '核实实际结果', WAIT: '等待下一次时间或变化',
};

export function presentGoalUnderstanding(raw: unknown, result: string | undefined) {
  const parsed = goalUnderstandingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const expectedLifecycle = ({ PLAN_DRAFT: 'PERSISTENT', USER_EVENT_DRAFT: 'USER_EVENT', ACTION_PROPOSAL: 'TEMPORARY', ANSWER: 'TEMPORARY', CLARIFICATION_REQUIRED: null } as Record<string, string | null>)[result ?? ''];
  if (expectedLifecycle === undefined || value.lifecycle !== expectedLifecycle) return null;
  return {
    title: presentation.text(value.summary, '请核对你的目标'),
    lifecycle: value.lifecycle ? lifecycleLabels[value.lifecycle] : '还需要补充信息',
    timezone: value.provenance.timezone,
    steps: value.steps.map(step => stepLabels[step]),
    capabilities: value.capabilities.map(capability => ({
      name: presentation.capability(capability.key),
      state: ({ AVAILABLE: '生成方案时可用', UNAVAILABLE: '需要恢复资源', UNRESOLVED: '需要检查资源' })[capability.availability],
      reasons: capability.reasons.map(reason => presentation.reason(reason)),
    })),
    missingRequirements: value.missingRequirements.map(reason => presentation.reason(reason)),
    policy: value.policy.confirmationRequired
      ? value.policy.approval === 'RUNTIME_POLICY' ? '确认方案后，执行仍按权限和独立审批处理。' : value.lifecycle === 'USER_EVENT' ? '确认后保存为内部事项。' : '确认本次应用与字段范围后读取，线索仍需独立核实。'
      : value.lifecycle ? '按当前授权读取与分析所需信息。' : '补充信息后再生成方案。',
  };
}
