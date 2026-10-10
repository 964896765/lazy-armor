import type { AgentLoopHistoryItem, AgentLoopReflection } from '@lazy-armor/plan-schema';
import { executionStatusLabel } from './execution-presenter';

export function loopReflectionLabel(outcome: AgentLoopReflection['outcome']): string {
  return { VERIFIED: '结果已核实', PARTIAL: '运行部分完成，需要留意', UNVERIFIED: '运行已结束，结果尚未核实',
    UNKNOWN: '结果未知，需要核对', FAILED: '运行未完成', CANCELLED: '运行已取消' }[outcome];
}

export function loopRunHistoryTitle(item: AgentLoopHistoryItem): string {
  return item.reflection ? loopReflectionLabel(item.reflection.outcome) : executionStatusLabel(item.state);
}

/** A plan activation can change version while an older history page is cached. */
export function loopHistoryItems(pages: Array<{ planVersionId: string | null; items: AgentLoopHistoryItem[] }>, expectedVersionId?: string | null) {
  const versionId = expectedVersionId === undefined ? pages[0]?.planVersionId : expectedVersionId;
  if (!versionId) return [];
  const seen = new Set<string>();
  return pages.filter(page => page.planVersionId === versionId).flatMap(page => page.items).filter(item => {
    if (item.planVersionId !== versionId || seen.has(item.id)) return false;
    seen.add(item.id); return true;
  });
}
