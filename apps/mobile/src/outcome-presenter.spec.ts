import { describe, expect, it } from 'vitest';
import { consumerOutcomeLabel, consumerOutcomeProjectionLabel, consumerOutcomeProjectionTone, consumerOutcomeTone, type ConsumerOutcomeProjection } from './outcome-presenter';

describe('consumer outcome presenter', () => {
  it('maps the four authoritative outcomes to consumer language', () => {
    expect(consumerOutcomeLabel('SUCCESS')).toBe('已完成');
    expect(consumerOutcomeLabel('FAILED')).toBe('执行失败');
    expect(consumerOutcomeLabel('PENDING_CONFIRMATION')).toBe('需要你确认');
    expect(consumerOutcomeLabel('OUTCOME_UNKNOWN')).toBe('结果待确认');
  });

  it('never renders an unknown outcome as success', () => {
    expect(consumerOutcomeLabel('OUTCOME_UNKNOWN')).not.toBe('已完成');
    expect(consumerOutcomeTone('OUTCOME_UNKNOWN')).toBe('warning');
    expect(consumerOutcomeTone('SUCCESS')).toBe('success');
    expect(consumerOutcomeTone('FAILED')).toBe('danger');
  });

  it('falls back to a neutral in-progress label when no result exists', () => {
    expect(consumerOutcomeLabel(null)).toBe('处理中');
    expect(consumerOutcomeLabel(undefined)).toBe('处理中');
    expect(consumerOutcomeTone(null)).toBe('neutral');
  });
});

describe('consumer outcome projection presenter', () => {
  const projection = (overrides: Partial<ConsumerOutcomeProjection> = {}): ConsumerOutcomeProjection => ({
    contractVersion: 1,
    outcome: null,
    title: '尚未运行',
    reason: '计划还没有执行过。',
    actionPath: null,
    evidenceRefs: [],
    ...overrides,
  });

  it('uses the server title and never treats null/unknown/pending as success', () => {
    expect(consumerOutcomeProjectionLabel(projection({ outcome: 'SUCCESS', title: '已完成' }))).toBe('已完成');
    expect(consumerOutcomeProjectionTone(projection({ outcome: 'SUCCESS' }))).toBe('success');

    expect(consumerOutcomeProjectionLabel(projection({ outcome: 'OUTCOME_UNKNOWN', title: '结果待确认' }))).toBe('结果待确认');
    expect(consumerOutcomeProjectionTone(projection({ outcome: 'OUTCOME_UNKNOWN' }))).toBe('warning');

    expect(consumerOutcomeProjectionLabel(projection({ outcome: 'PENDING_CONFIRMATION', title: '需要你确认' }))).toBe('需要你确认');
    expect(consumerOutcomeProjectionTone(projection({ outcome: 'PENDING_CONFIRMATION' }))).toBe('warning');
  });

  it('keeps null outcomes (not run / processing / no result) neutral', () => {
    expect(consumerOutcomeProjectionLabel(projection({ outcome: null, title: '处理中' }))).toBe('处理中');
    expect(consumerOutcomeProjectionTone(projection({ outcome: null }))).toBe('neutral');
    expect(consumerOutcomeProjectionTone(projection({ outcome: null }))).not.toBe('success');
  });

  it('falls back to a neutral label when the projection is missing', () => {
    expect(consumerOutcomeProjectionLabel(undefined)).toBe('处理中');
    expect(consumerOutcomeProjectionTone(undefined)).toBe('neutral');
  });
});
