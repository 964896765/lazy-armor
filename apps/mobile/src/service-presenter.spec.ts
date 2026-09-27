import { describe, expect, it } from 'vitest';
import { filterServicePlans, presentServicePlan, type ServicePlanProjection } from './service-presenter';

const plans: ServicePlanProjection[] = [
  { id: 'supply', status: 'active', name: '家庭补给', templateKey: 'family-supply-reminder', currentVersion: { name: '家庭补给', domain: 'family' }, latestExecution: { id: 'e1', status: 'waiting_approval', resultSummary: '采购清单已经准备，等待确认', createdAt: '2026-09-27T00:00:00Z' } },
  { id: 'clean', status: 'paused', name: '家电清洁提醒', templateKey: 'appliance-maintenance', currentVersion: { name: '家电维护', domain: 'device' }, latestExecution: null },
  { id: 'finance', status: 'draft', name: '月度账目整理', templateKey: 'finance-accounting', currentVersion: { name: '账目整理', domain: 'finance' }, latestExecution: null },
];

describe('service presenter', () => {
  it('uses only persisted plan and execution fields for consumer cards', () => {
    expect(presentServicePlan(plans[0])).toMatchObject({ kind: 'supply', kindLabel: '补给', statusLabel: '等待确认', title: '家庭补给' });
    expect(presentServicePlan(plans[1])).toMatchObject({ kind: 'service', kindLabel: '服务', statusLabel: '计划已暂停' });
  });

  it('filters actual active plans and supports deterministic local search', () => {
    expect(filterServicePlans(plans, 'active', '', 'all').map((item) => item.id)).toEqual(['supply', 'clean']);
    expect(filterServicePlans(plans, 'recommended', '账目', 'all').map((item) => item.id)).toEqual(['finance']);
    expect(filterServicePlans(plans, 'recommended', '', 'supply').map((item) => item.id)).toEqual(['supply']);
  });

  it('does not invent follows or nearby providers without server projections', () => {
    expect(filterServicePlans(plans, 'following', '', 'all')).toEqual([]);
    expect(filterServicePlans(plans, 'nearby', '', 'all')).toEqual([]);
  });
});
