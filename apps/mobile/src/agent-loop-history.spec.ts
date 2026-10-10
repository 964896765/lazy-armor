import { describe, expect, it } from 'vitest';
import type { AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { loopHistoryItems } from './agent-loop-presenter';
const item = (id: string, planVersionId: string): AgentLoopHistoryItem => ({ id, planVersionId, kind: 'CHECKPOINT',
  state: 'WAITING_FACT_CHANGE', recordedAt: '2026-10-10T10:00:00Z', nextRunAt: null, executionId: null, reflection: null });
describe('history pages after the applied plan changes', () => {
  it('does not merge a new applied version with cached older pages', () => {
    const pages = [{ planVersionId: 'old', items: [item('old-run','old')] }, { planVersionId: 'new', items: [item('new-run','new')] }];
    expect(loopHistoryItems(pages, 'new').map(row => row.id)).toEqual(['new-run']);
    expect(loopHistoryItems(pages).map(row => row.id)).toEqual(['old-run']);
  });
  it('deduplicates page overlap and rejects an item not belonging to that page version', () => {
    expect(loopHistoryItems([{ planVersionId: 'applied', items: [item('a','applied'), item('wrong','draft')] },
      { planVersionId: 'applied', items: [item('a','applied'), item('b','applied')] }]).map(row => row.id)).toEqual(['a','b']);
  });
  it('does not show old data when the current plan no longer has a version', () => {
    expect(loopHistoryItems([{ planVersionId: 'old', items: [item('a','old')] }], null)).toEqual([]);
  });
});
