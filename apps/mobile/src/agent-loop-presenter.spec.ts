import type { AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { describe, expect, it } from 'vitest';
import { loopReflectionLabel, loopRunHistoryTitle } from './agent-loop-presenter';

const history: AgentLoopHistoryItem = { id: 'run', kind: 'RUN', planVersionId: 'version', recordedAt: '2026-10-10T08:00:00Z',
  state: 'succeeded', nextRunAt: null, executionId: 'run', reflection: null };
function reflected(outcome: NonNullable<AgentLoopHistoryItem['reflection']>['outcome']) {
  return { ...history, reflection: { executionId: 'run', planVersionId: 'version', recordedStatus: history.state,
    outcome, verifiedResultCount: 0, evaluatedAt: '2026-10-10T09:00:00Z' } };
}
describe('Loop history displays verification independently of executor status', () => {
  it('does not call a successful executor a verified result without evidence', () => {
    expect(loopRunHistoryTitle(reflected('UNVERIFIED'))).toContain('尚未核实');
    expect(loopRunHistoryTitle(reflected('UNKNOWN'))).toContain('未知');
  });
  it('displays current lookup success while leaving the failed historical status intact', () => {
    const row = { ...reflected('VERIFIED'), state: 'failed' };
    expect(loopRunHistoryTitle(row)).toBe('结果已核实');
    expect(row.state).toBe('failed');
  });
  it('shows known partial results and failures without calling them unknown or complete', () => {
    expect(loopRunHistoryTitle(reflected('PARTIAL'))).toContain('部分完成');
    expect(loopReflectionLabel('FAILED')).toBe('运行未完成');
    expect(loopReflectionLabel('CANCELLED')).toBe('运行已取消');
  });
  it('can show a nonterminal run or an older API without reflection', () => {
    expect(loopRunHistoryTitle({ ...history, state: 'running' })).toBe('正在处理');
  });
});
