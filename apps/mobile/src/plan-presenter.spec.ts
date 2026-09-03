import { describe, expect, it } from 'vitest';
import { consumerPlanGroup, consumerPlanGroupSubtitle, planNextRunLabel, planStatusLabel, planStatusTone, planVisualIcon, templateGroupLabel } from './plan-presenter';

describe('Plan presenter', () => {
  it('maps known templates into the four consumer groups', () => {
    expect(consumerPlanGroup({ templateKey: 'device-consumable-reminder' })).toBe('我的东西');
    expect(consumerPlanGroup({ templateKey: 'daily-important-summary' })).toBe('我的事情');
    expect(consumerPlanGroup({ templateKey: 'monthly-bill-summary' })).toBe('我的钱');
    expect(consumerPlanGroup({ templateKey: 'quiet-delivery-guard' })).toBe('我的生活');
  });

  it('falls back to plan-center kind when template key is unavailable', () => {
    expect(consumerPlanGroup({ planCenterKind: 'household' })).toBe('我的生活');
    expect(consumerPlanGroup({ planCenterKind: 'device' })).toBe('我的东西');
    expect(consumerPlanGroup({ planCenterKind: 'study' })).toBe('我的事情');
    expect(consumerPlanGroup({ planCenterKind: 'unknown' })).toBe('其他计划');
  });

  it('keeps group subtitles and labels in consumer language', () => {
    expect(templateGroupLabel('我的钱')).toBe('我的钱');
    expect(consumerPlanGroupSubtitle('我的钱')).toContain('账单');
    expect(consumerPlanGroupSubtitle('我的生活')).toContain('生活');
  });

  it('builds consumer-facing plan card content without internal statuses', () => {
    expect(planVisualIcon('每日重要事项摘要', 'daily_summary')).toBe('✉️');
    expect(planVisualIcon('车辆保养提醒')).toBe('🚙');
    expect(planStatusLabel('degraded')).toBe('需要留意');
    expect(planStatusLabel('blocked')).toBe('暂时停下');
    expect(planStatusTone('active')).toBe('success');
    expect(planStatusTone('draft')).toBe('warning');
    expect(planStatusTone('paused')).toBe('muted');
    expect(planNextRunLabel('paused', null)).toBe('需要时可以重新开启');
    expect(planNextRunLabel('active', null)).toBe('下一次时间正在安排');
  });
});
