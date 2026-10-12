import { describe, expect, it } from 'vitest';
import { learningOutcomeLabel, learningStatusLabel } from './learning-presenter';
import { memoryMutationError, memoryReferenceLabel, memorySourceLabel } from './memory-presenter';
import type { PersonalMemory } from '@lazy-armor/plan-schema/mobile';
describe('learning result language preserves evidence limits', () => {
  it('never describes unknown, failure or partial evidence as verified success', () => {
    expect(learningOutcomeLabel('SUCCEEDED')).toBe('已核验成功');
    expect(learningOutcomeLabel('FAILED')).toBe('已核验失败');
    expect(learningOutcomeLabel('PARTIALLY_SUCCEEDED')).toBe('已核验部分成功');
    expect(learningOutcomeLabel('OUTCOME_UNKNOWN')).toBe('尚无可用核验结果');
  });
  it('makes confirmation, rejection and source withdrawal visible', () => {
    expect(learningStatusLabel('PENDING')).toBe('待你核对');
    expect(learningStatusLabel('CONFIRMED')).toBe('已保存为历史经验');
    expect(learningStatusLabel('DISMISSED')).toBe('已忽略');
    expect(memoryReferenceLabel('SOURCE_UNAVAILABLE')).toContain('不再使用');
    expect(memoryMutationError({ message: 'LEARNING_SOURCE_CHANGED' })).toContain('授权已变化');
  });
  it('distinguishes verified source history from user input and confirmed conversation facts', () => {
    expect(memorySourceLabel({ sourceKind: 'LEARNING_CONFIRMED', expiresAt: null } as PersonalMemory)).toBe('来自核验结果，由你确认 · 个人信息');
    expect(memorySourceLabel({ sourceKind: 'USER_INPUT', expiresAt: null } as PersonalMemory)).toBe('你确认提供 · 个人信息');
    expect(memorySourceLabel({ sourceKind: 'REPORT_DECISION_CONFIRMED', expiresAt: null } as PersonalMemory)).toContain('由你确认的决定');
  });
});
