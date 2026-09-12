import { describe, expect, it } from 'vitest';
import { canRequestReconciliation, reconciliationStatusLabel, runtimeResultLabel, verificationSafetyCopy } from './verification-presenter';
describe('verification consumer state', () => {
  it('distinguishes unknown and partial outcomes from ordinary failure', () => {
    expect(runtimeResultLabel('OUTCOME_UNKNOWN')).toContain('结果未知');
    expect(runtimeResultLabel('PARTIALLY_SUCCEEDED')).toBe('部分成功');
    expect(runtimeResultLabel('SUCCEEDED')).toBe('已确认成功');
    expect(runtimeResultLabel(null)).toBeNull();
  });
  it('only offers bounded read-only recheck for open cases', () => {
    expect(canRequestReconciliation({ id: 'c', status: 'OPEN', resultState: 'OUTCOME_UNKNOWN', attemptCount: 0 })).toBe(true);
    for (const status of ['RECONCILING', 'RESOLVED', 'NEEDS_USER'] as const) expect(canRequestReconciliation({ id: 'c', status, resultState: 'OUTCOME_UNKNOWN', attemptCount: 1 })).toBe(false);
    expect(reconciliationStatusLabel('NEEDS_USER')).toContain('核实');
    expect(verificationSafetyCopy()).toContain('不会重发原动作');
  });
});
