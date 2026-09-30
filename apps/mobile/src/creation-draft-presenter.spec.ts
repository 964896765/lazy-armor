import { describe, expect, it } from 'vitest';
import type { CreationDraft, CreationDraftResumeAssessment } from '@lazy-armor/plan-schema';
import {
  activeCreationDraftCount,
  buildCreationDraftInput,
  creationDraftSaveLabel,
  creationDraftSummary,
  creationWizardStageLabel,
  isActiveCreationDraft,
  resumeReasonCopy,
  resumeTargetStage,
} from './creation-draft-presenter';

function draft(overrides: Partial<CreationDraft> = {}): CreationDraft {
  return {
    contractVersion: 1,
    draftId: 'draft-1',
    scenarioKey: 'daily_life.delivery',
    scenarioRevision: 3,
    stage: 2,
    goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '盯住快递变化', constraints: {} },
    subject: { resourceType: 'shipment', subjectKey: 'SF123456' },
    sourceChoices: [],
    selectedOfferKey: null,
    version: 1,
    state: 'ACTIVE',
    createdAt: '2026-09-26T08:00:00.000Z',
    updatedAt: '2026-09-26T08:00:00.000Z',
    expiresAt: '2026-09-27T08:00:00.000Z',
    ...overrides,
  };
}

function assessment(overrides: Partial<CreationDraftResumeAssessment> = {}): CreationDraftResumeAssessment {
  return {
    contractVersion: 1,
    draftId: 'draft-1',
    state: 'READY',
    reasonCodes: [],
    scenario: { key: 'daily_life.delivery', revision: 3, contractHash: 'hash' },
    goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '盯住快递变化', constraints: {} },
    subject: { resourceType: 'shipment', subjectKey: 'SF123456' },
    currentStage: 3,
    selectedOfferKey: null,
    evaluatedAt: '2026-09-26T08:00:00.000Z',
    ...overrides,
  };
}

describe('creation-draft presenter', () => {
  it('labels the five wizard stages in order', () => {
    expect([1, 2, 3, 4, 5].map((stage) => creationWizardStageLabel(stage as never))).toEqual([
      '选择目标', '确定对象', '检查来源', '选择方案', '确认创建',
    ]);
  });

  it('maps resume states to the stage that must be re-entered', () => {
    expect(resumeTargetStage('READY', 3)).toBe(3);
    expect(resumeTargetStage('NEEDS_SUBJECT', 3)).toBe(2);
    expect(resumeTargetStage('NEEDS_SOURCE_REVIEW', 3)).toBe(3);
    expect(resumeTargetStage('NEEDS_OFFER_REGENERATION', 3)).toBe(4);
    expect(resumeTargetStage('NEEDS_RECONFIRMATION', 3)).toBe(5);
  });

  it('only counts ACTIVE drafts for the homepage resume entry', () => {
    const drafts = [
      draft({ draftId: 'a', state: 'ACTIVE' }),
      draft({ draftId: 'b', state: 'ACTIVE' }),
      draft({ draftId: 'c', state: 'COMPLETED' }),
      draft({ draftId: 'd', state: 'DISCARDED' }),
      draft({ draftId: 'e', state: 'EXPIRED' }),
    ];
    expect(isActiveCreationDraft(drafts[0])).toBe(true);
    expect(activeCreationDraftCount(drafts)).toBe(2);
  });

  it('summarizes a draft without inferring any server authority', () => {
    expect(creationDraftSummary(draft())).toBe('确定对象 · NOTIFY_ON_DELIVERY_CHANGE · SF123456');
    expect(creationDraftSummary(draft({ subject: null }))).toContain('未确定对象');
  });

  it('labels each save state for the footer', () => {
    expect(creationDraftSaveLabel('idle')).toBe('尚未保存');
    expect(creationDraftSaveLabel('saving')).toBe('保存中…');
    expect(creationDraftSaveLabel('saved')).toBe('已保存');
    expect(creationDraftSaveLabel('error')).toBe('保存失败');
  });

  it('builds a save input only when scenario identity and goal are complete', () => {
    expect(buildCreationDraftInput({
      scenarioKey: null, scenarioRevision: 3, stage: 1,
      goal: { intent: 'x', description: 'y', constraints: {} }, subject: null, sourceChoices: [], selectedOfferKey: null,
    })).toBeNull();
    expect(buildCreationDraftInput({
      scenarioKey: 'daily_life.delivery', scenarioRevision: null, stage: 1,
      goal: { intent: 'x', description: 'y', constraints: {} }, subject: null, sourceChoices: [], selectedOfferKey: null,
    })).toBeNull();
    expect(buildCreationDraftInput({
      scenarioKey: 'daily_life.delivery', scenarioRevision: 3, stage: 1,
      goal: null, subject: null, sourceChoices: [], selectedOfferKey: null,
    })).toBeNull();

    const input = buildCreationDraftInput({
      scenarioKey: 'daily_life.delivery', scenarioRevision: 3, stage: 3,
      goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '盯住快递变化', constraints: {} },
      subject: { resourceType: 'shipment', subjectKey: 'SF123456' },
      sourceChoices: [{ demandId: 'fd_1', sourceId: 'connection:c1:cap' }],
      selectedOfferKey: null,
      version: 4,
    });
    expect(input).toEqual({
      scenarioKey: 'daily_life.delivery',
      scenarioRevision: 3,
      stage: 3,
      goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '盯住快递变化', constraints: {} },
      subject: { resourceType: 'shipment', subjectKey: 'SF123456' },
      sourceChoices: [{ demandId: 'fd_1', sourceId: 'connection:c1:cap' }],
      version: 4,
    });
  });

  it('omits optional fields when they are absent', () => {
    const input = buildCreationDraftInput({
      scenarioKey: 'daily_life.delivery', scenarioRevision: 3, stage: 2,
      goal: { intent: 'x', description: 'y', constraints: {} },
      subject: null, sourceChoices: [], selectedOfferKey: null,
    });
    expect(input).toEqual({
      scenarioKey: 'daily_life.delivery',
      scenarioRevision: 3,
      stage: 2,
      goal: { intent: 'x', description: 'y', constraints: {} },
      subject: null,
    });
  });

  it('provides a readable reason for every resume state', () => {
    expect(resumeReasonCopy(assessment({ state: 'NEEDS_SUBJECT' }))).toContain('对象');
    expect(resumeReasonCopy(assessment({ state: 'NEEDS_OFFER_REGENERATION' }))).toContain('重新生成方案');
    expect(resumeReasonCopy(assessment({ state: 'READY' }))).toContain('可以继续创建');
  });
});
