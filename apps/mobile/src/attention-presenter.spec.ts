import { describe, expect, it } from 'vitest';
import {
  attentionNeedsCount,
  buildAttentionSections,
  type AttentionAlert,
  type AttentionReconciliation,
  type AttentionToday,
} from './attention-presenter';

const reconciliation = (id: string, status: AttentionReconciliation['status']): AttentionReconciliation => ({
  id, status, resultState: 'OUTCOME_UNKNOWN', attemptCount: 1, executionId: `exec-${id}`, createdAt: '2026-09-22T10:00:00Z', updatedAt: '2026-09-22T10:01:00Z', expiresAt: '2026-09-22T12:00:00Z',
});

const alert = (id: string, title: string, category: AttentionAlert['category']): AttentionAlert => ({
  id, title, body: '', priority: 'P1', createdAt: '2026-09-22T09:00:00Z', category,
});

const today = (overrides: Partial<AttentionToday> = {}): AttentionToday => ({
  pendingApprovals: [], connectionIssues: [], alerts: [], processed: [], ...overrides,
});

describe('attention presenter', () => {
  it('groups approvals and reconciliation that need a decision under 需要决定', () => {
    const sections = buildAttentionSections(today({
      pendingApprovals: [{ id: 'a1', planName: '还款计划', summary: '扣款 ¥200', riskLevel: 'R3', expiresAt: '2026-09-22T12:00:00Z' }],
    }), [reconciliation('r1', 'NEEDS_USER')]);
    const decision = sections.find((section) => section.key === 'decision');
    expect(decision).toBeDefined();
    expect(decision!.rows.map((row) => row.id)).toEqual(['approval:a1', 'reconcile:r1']);
    expect(decision!.rows[0].status).toBe('需要你确认');
    expect(decision!.rows[1].status).toBe('需要你核实实际结果');
  });

  it('separates OPEN/RECONCILING reconciliation into 结果待确认 and skips resolved cases', () => {
    const sections = buildAttentionSections(today(), [reconciliation('r1', 'OPEN'), reconciliation('r2', 'RECONCILING'), reconciliation('r3', 'RESOLVED')]);
    const outcome = sections.find((section) => section.key === 'outcome');
    expect(outcome).toBeDefined();
    expect(outcome!.rows.map((row) => row.id)).toEqual(['reconcile:r1', 'reconcile:r2']);
    expect(sections.flatMap((section) => section.rows).some((row) => row.id === 'reconcile:r3')).toBe(false);
  });

  it('routes connection issues and exception alerts into 异常', () => {
    const sections = buildAttentionSections(today({
      connectionIssues: [{ connectionId: 'c1', connectionStatus: 'expired', providerName: '支付宝', planName: '还款计划' }],
      alerts: [alert('n1', '连接失效', 'exception')],
    }), []);
    const exception = sections.find((section) => section.key === 'exception');
    expect(exception).toBeDefined();
    expect(exception!.rows.map((row) => row.source)).toContain('支付宝');
    expect(exception!.rows.some((row) => row.id === 'alert:n1')).toBe(true);
  });

  it('routes attention alerts into 提醒 and processed results into 已完成', () => {
    const sections = buildAttentionSections(today({
      alerts: [alert('n2', '即将到期', 'attention')],
      processed: [{ id: 'e1', status: 'succeeded', resultSummary: '已扣款', finishedAt: '2026-09-22T08:00:00Z', planName: '还款计划' }],
    }), []);
    const reminder = sections.find((section) => section.key === 'reminder');
    const done = sections.find((section) => section.key === 'done');
    expect(reminder?.rows.map((row) => row.id)).toEqual(['alert:n2']);
    expect(done?.rows.map((row) => row.id)).toEqual(['result:e1']);
  });

  it('counts only rows that need attention and excludes completed', () => {
    const input = today({
      pendingApprovals: [{ id: 'a1', planName: '还款计划', summary: '扣款', riskLevel: 'R3', expiresAt: '2026-09-22T12:00:00Z' }],
      processed: [{ id: 'e1', status: 'succeeded', resultSummary: '已扣款', finishedAt: null, planName: '还款计划' }],
    });
    expect(attentionNeedsCount(input, [reconciliation('r1', 'OPEN')])).toBe(2);
    expect(attentionNeedsCount(today(), [])).toBe(0);
  });

  it('returns no sections when nothing needs attention', () => {
    expect(buildAttentionSections(today(), [])).toEqual([]);
  });
});
