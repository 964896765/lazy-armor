import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { activePlanUsageLabel, formatFileBytes, historyRetentionLabel, planMutationErrorMessage, usagePeriodLabel, type MembershipSummary } from './membership-presenter';

const summary: MembershipSummary = {
  membership: { planKey: 'free', effectivePlanKey: 'free', name: '免费版', status: 'active', currentPeriodEnd: null },
  capabilities: { advanced_ai: false, premium_connector: false, advanced_summary: false, premium_template: false },
  limits: { max_active_plans: 3, max_total_plans: 30, history_retention_days: 30 },
  usage: { activePlans: 2, totalPlans: 4 },
  upgrade: { available: false, mode: 'coming_soon' },
};

describe('membership presenter', () => {
  it('presents plan usage and retention in consumer language', () => {
    expect(activePlanUsageLabel(summary)).toBe('已启用 2 / 3 个计划');
    expect(historyRetentionLabel(30)).toBe('保留最近 30 天的历史记录');
  });

  it('formats consumer-facing monthly usage values', () => {
    expect(usagePeriodLabel('2026-09-01T00:00:00.000Z')).toBe('2026 年 9 月用量');
    expect(formatFileBytes(512)).toBe('512 B');
    expect(formatFileBytes(1536)).toBe('1.5 KB');
    expect(formatFileBytes(1572864)).toBe('1.5 MB');
  });

  it('preserves the human-readable plan limit message', () => {
    const error = new ApiError(403, 'PLAN_LIMIT_REACHED', '免费版最多可以同时启用 3 个计划。');
    expect(planMutationErrorMessage(error)).toBe('免费版最多可以同时启用 3 个计划。');
    expect(planMutationErrorMessage(new Error('internal'))).toBe('操作失败，请稍后重试。');
  });
});
