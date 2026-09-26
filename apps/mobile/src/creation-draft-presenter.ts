import type {
  CreationDraft,
  CreationDraftInput,
  CreationDraftResumeAssessment,
  CreationDraftResumeState,
  CreationDraftSourceChoiceInput,
  CreationDraftStage,
  ScenarioGoalSpec,
  ScenarioResourceSubject,
} from '@lazy-armor/plan-schema';

/**
 * 五阶段创建向导的展示映射（纯函数）。
 *
 * 只消费共享合同中的 CreationDraft / CreationDraftResumeAssessment DTO，
 * 不复制 Plan/Truth/Approval 状态机，不推断已授权 / 已在线 / 来源新鲜度。
 * 阶段文案属于展示层，不是合同字段。
 */
export const CREATION_WIZARD_STAGE_LABELS = [
  '选择目标',
  '确定对象',
  '检查来源',
  '选择方案',
  '确认创建',
] as const;

export function creationWizardStageLabel(stage: CreationDraftStage): string {
  return CREATION_WIZARD_STAGE_LABELS[stage - 1] ?? `第 ${stage} 步`;
}

/**
 * 恢复评估状态 → 应进入的向导阶段。
 * READY 直接回到草稿所在阶段；其余状态回到对应阶段并要求重新校验。
 */
export function resumeTargetStage(state: CreationDraftResumeState, currentStage: CreationDraftStage): CreationDraftStage {
  switch (state) {
    case 'READY':
      return currentStage;
    case 'NEEDS_SUBJECT':
      return 2;
    case 'NEEDS_SOURCE_REVIEW':
      return 3;
    case 'NEEDS_OFFER_REGENERATION':
      return 4;
    case 'NEEDS_RECONFIRMATION':
      return 5;
  }
}

/** 恢复评估的消费者可读原因，供恢复后提示用户为何回到该阶段。 */
export function resumeReasonCopy(assessment: CreationDraftResumeAssessment): string {
  switch (assessment.state) {
    case 'READY':
      return '草稿复核通过，可以继续创建。';
    case 'NEEDS_SUBJECT':
      return '对象信息缺失或已失效，需要重新确定对象。';
    case 'NEEDS_SOURCE_REVIEW':
      return '来源授权、新鲜度或治理状态需要重新检查。';
    case 'NEEDS_OFFER_REGENERATION':
      return '方案已过期或前置条件变化，需要重新生成方案。';
    case 'NEEDS_RECONFIRMATION':
      return '方案前置条件已变化，需要重新确认授权边界。';
  }
}

export function isActiveCreationDraft(draft: CreationDraft): boolean {
  return draft.state === 'ACTIVE';
}

/** 首页「继续创建 N」的数量只统计仍可继续的 ACTIVE 草稿。 */
export function activeCreationDraftCount(drafts: readonly CreationDraft[]): number {
  return drafts.filter(isActiveCreationDraft).length;
}

/** 草稿列表里的一句可读摘要，用于区分多个进行中的草稿。 */
export function creationDraftSummary(draft: CreationDraft): string {
  const subject = draft.subject?.displayName ?? draft.subject?.subjectKey ?? '未确定对象';
  return `${creationWizardStageLabel(draft.stage)} · ${draft.goal.intent} · ${subject}`;
}

export type CreationDraftSaveState = 'idle' | 'saving' | 'saved' | 'error';

export function creationDraftSaveLabel(state: CreationDraftSaveState): string {
  switch (state) {
    case 'saving':
      return '保存中…';
    case 'saved':
      return '已保存';
    case 'error':
      return '保存失败';
    default:
      return '尚未保存';
  }
}

/**
 * 依据向导进度构建可自动保存的 CreationDraftInput。
 * 只有在场景身份、修订版本与 goal 齐备时才可保存（合同要求 goal 非空）；
 * 返回 null 表示当前进度尚未达到可保存的完整性。
 */
export function buildCreationDraftInput(input: {
  scenarioKey: string | null;
  scenarioRevision: number | null;
  stage: CreationDraftStage;
  goal: ScenarioGoalSpec | null;
  subject: ScenarioResourceSubject | null;
  sourceChoices: readonly CreationDraftSourceChoiceInput[];
  selectedOfferKey: string | null;
  version?: number;
}): CreationDraftInput | null {
  if (!input.scenarioKey || !input.scenarioRevision || !input.goal) return null;
  return {
    scenarioKey: input.scenarioKey,
    scenarioRevision: input.scenarioRevision,
    stage: input.stage,
    goal: input.goal,
    subject: input.subject,
    ...(input.sourceChoices.length > 0 ? { sourceChoices: input.sourceChoices.map((choice) => ({ ...choice })) } : {}),
    ...(input.selectedOfferKey ? { selectedOfferKey: input.selectedOfferKey } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
  };
}
