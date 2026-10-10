import { describe, expect, it } from 'vitest';
import { buildLoopCoverage, loopCoverageWindow } from '../src/agent-loop-coverage';
import type { AgentLoopHistoryItem } from '../src/agent-loop';

const asOf = new Date('2026-10-10T16:30:00Z'); // October 11 in Shanghai.
const run = (id: string, recordedAt: string, outcome = 'VERIFIED'): AgentLoopHistoryItem => ({
  id, kind: 'RUN', planVersionId: 'applied', recordedAt, state: 'succeeded', executionId: id, nextRunAt: null,
  reflection: { executionId: id, planVersionId: 'applied', recordedStatus: 'succeeded', outcome: outcome as 'VERIFIED', verifiedResultCount: 1, evaluatedAt: asOf.toISOString() },
});
const coverage = (records: AgentLoopHistoryItem[], recordsComplete = true) => buildLoopCoverage({ planId: 'owned', planVersionId: 'applied', asOf, records, recordsComplete });
describe('seven calendar dates of actual loop records', () => {
  it('uses Shanghai midnight, excludes old/future records and emits empty calendar dates', () => {
    expect(loopCoverageWindow(asOf).start.toISOString()).toBe('2026-10-04T16:00:00.000Z');
    const result = coverage([run('old', '2026-10-04T15:59:59Z'), run('first', '2026-10-04T16:00:00Z'), run('today', asOf.toISOString()), run('future', '2026-10-10T16:30:01Z')]);
    expect(result.days.map(day => day.date)).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
    expect(result.recordedDayCount).toBe(2); expect(result.verifiedDayCount).toBe(2);
  });
  it('deduplicates records and rejects another version or mismatched verification identity', () => {
    const record = run('same', '2026-10-08T09:00:00Z');
    const result = coverage([record, record, { ...record, id: 'draft', planVersionId: 'draft' },
      { ...run('wrong', record.recordedAt), reflection: { ...record.reflection!, executionId: 'other' } }, run('invalid', 'not-a-date')]);
    expect(result.days.find(day => day.date === '2026-10-08')).toMatchObject({ runCount: 2, verifiedRunCount: 1 });
  });
  it('keeps WAIT checkpoints, unverified executor success and UNKNOWN separate', () => {
    const pending = { ...run('unverified', '2026-10-09T01:00:00Z'), reflection: null };
    const wait = { ...run('wait', '2026-10-08T01:00:00Z'), kind: 'CHECKPOINT' as const, state: 'WAITING_FACT_CHANGE', executionId: null, reflection: null };
    const result = coverage([wait, pending, run('unknown', '2026-10-09T02:00:00Z', 'UNKNOWN')]);
    expect(result.recordedDayCount).toBe(2); expect(result.verifiedDayCount).toBe(0);
    expect(result.days.find(day => day.date === '2026-10-08')).toMatchObject({ checkpointCount: 1, runCount: 0 });
    expect(result.days.find(day => day.date === '2026-10-09')).toMatchObject({ runCount: 2, needsAttentionRunCount: 1 });
  });
  it('never certifies continuity or grants execution, even with seven verified dates', () => {
    const records = Array.from({ length: 7 }, (_, index) => run(String(index), `2026-10-${String(5 + index).padStart(2, '0')}T00:00:00+08:00`));
    const result = coverage(records, false);
    expect(result.verifiedDayCount).toBe(7); expect(result.recordsComplete).toBe(false);
    expect(result.continuityVerified).toBe(false); expect(result.executionAuthorized).toBe(false);
    expect(coverage([]).continuityVerified).toBe(false);
  });
  it('does not count records for a plan with no applied or current version', () => {
    expect(buildLoopCoverage({ planId: 'owned', planVersionId: null, asOf, records: [run('x', asOf.toISOString())], recordsComplete: true }).recordedDayCount).toBe(0);
  });
});
