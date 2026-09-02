import { describe, expect, it } from 'vitest';
import { consumerPlanGroup, consumerPlanGroupSubtitle, templateGroupLabel } from './plan-presenter';

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
});
