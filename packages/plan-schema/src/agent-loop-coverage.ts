import type { AgentLoopHistoryItem } from './agent-loop';

export interface AgentLoopCoverageDay {
  date: string;
  runCount: number;
  checkpointCount: number;
  verifiedRunCount: number;
  needsAttentionRunCount: number;
}
export interface AgentLoopCoverage {
  schemaVersion: 'agent-loop-coverage.v1';
  planId: string;
  planVersionId: string | null;
  timezone: 'Asia/Shanghai';
  windowStartedAt: string;
  asOf: string;
  days: AgentLoopCoverageDay[];
  recordedDayCount: number;
  verifiedDayCount: number;
  recordsComplete: boolean;
  continuityVerified: false;
  executionAuthorized: false;
}
const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;
/** Seven calendar dates in the user's timezone, including the current partial day. */
export function loopCoverageWindow(asOf: Date) {
  if (!Number.isFinite(asOf.getTime())) throw new Error('Invalid coverage time');
  const today = new Date(asOf.getTime() + OFFSET).toISOString().slice(0, 10);
  const todayStart = Date.parse(today + 'T00:00:00+08:00');
  return { start: new Date(todayStart - 6 * DAY), end: asOf };
}
/** Record coverage is not proof of worker uptime, source freshness or seven-day acceptance. */
export function buildLoopCoverage(input: {
  planId: string; planVersionId: string | null; asOf: Date;
  records: AgentLoopHistoryItem[]; recordsComplete: boolean;
}): AgentLoopCoverage {
  const window = loopCoverageWindow(input.asOf);
  const days = Array.from({ length: 7 }, (_, index): AgentLoopCoverageDay => ({
    date: new Date(window.start.getTime() + index * DAY + OFFSET).toISOString().slice(0, 10),
    runCount: 0, checkpointCount: 0, verifiedRunCount: 0, needsAttentionRunCount: 0,
  }));
  const byDate = new Map(days.map(day => [day.date, day]));
  const seen = new Set<string>();
  for (const record of input.records) {
    const at = Date.parse(record.recordedAt), identity = record.kind + ':' + record.id;
    if (!input.planVersionId || record.planVersionId !== input.planVersionId || !Number.isFinite(at)
      || at < window.start.getTime() || at > window.end.getTime() || seen.has(identity)) continue;
    seen.add(identity);
    const day = byDate.get(new Date(at + OFFSET).toISOString().slice(0, 10));
    if (!day) continue;
    if (record.kind === 'CHECKPOINT') { day.checkpointCount++; continue; }
    day.runCount++;
    const reflection = record.reflection;
    if (reflection?.executionId === record.executionId && record.executionId === record.id
      && reflection.planVersionId === input.planVersionId) {
      if (reflection.outcome === 'VERIFIED') day.verifiedRunCount++;
      if (['PARTIAL', 'FAILED', 'UNKNOWN'].includes(reflection.outcome)) day.needsAttentionRunCount++;
    }
  }
  return { schemaVersion: 'agent-loop-coverage.v1', planId: input.planId, planVersionId: input.planVersionId,
    timezone: 'Asia/Shanghai', windowStartedAt: window.start.toISOString(), asOf: input.asOf.toISOString(), days,
    recordedDayCount: days.filter(day => day.runCount + day.checkpointCount > 0).length,
    verifiedDayCount: days.filter(day => day.verifiedRunCount > 0).length,
    recordsComplete: input.recordsComplete, continuityVerified: false, executionAuthorized: false };
}
