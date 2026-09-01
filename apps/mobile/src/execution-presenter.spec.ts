import { describe, expect, it } from 'vitest';
import { executionListState, executionStatusLabel, executionStepMark, sortExecutionSteps } from './execution-presenter';

describe('Execution records presenter', () => {
  it('distinguishes loading, failure, empty and populated record lists', () => {
    expect(executionListState(true, false, 0)).toBe('loading');
    expect(executionListState(false, true, 0)).toBe('error');
    expect(executionListState(false, false, 0)).toBe('empty');
    expect(executionListState(false, false, 1)).toBe('ready');
  });

  it('presents success, failure, retry and cancellation states in user language', () => {
    expect(executionStatusLabel('succeeded')).toBe('已完成');
    expect(executionStatusLabel('failed')).toBe('执行失败');
    expect(executionStatusLabel('retry_wait')).toBe('正在重试');
    expect(executionStatusLabel('cancelled')).toBe('已取消');
    expect(executionStatusLabel('waiting_approval')).toBe('等待确认');
    expect(executionStepMark('succeeded')).toBe('✓');
    expect(executionStepMark('failed')).toBe('!');
  });

  it('keeps detail Steps in their execution order without mutating API data', () => {
    const input = [{ stepOrder: 2, status: 'pending' }, { stepOrder: 0, status: 'succeeded' }, { stepOrder: 1, status: 'retry_wait' }];
    expect(sortExecutionSteps(input).map((step) => step.stepOrder)).toEqual([0, 1, 2]);
    expect(input.map((step) => step.stepOrder)).toEqual([2, 0, 1]);
  });
});
