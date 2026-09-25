import { describe, expect, it } from 'vitest';
import { consumerOutcomeLabel, consumerOutcomeTone } from './outcome-presenter';

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
