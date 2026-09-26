import { describe, expect, it } from 'vitest';
import {
  HOME_SPACES,
  allHomeDomainKeys,
  homeDomainsForSpace,
  presentRunningPlan,
  selectRunningPlanCards,
  type HomeRecentPlan,
} from './home-presenter';

function plan(overrides: Partial<HomeRecentPlan> = {}): HomeRecentPlan {
  return {
    planId: 'plan-1',
    planName: '快递跟进',
    planStatus: 'active',
    latestExecutionId: null,
    executionStatus: null,
    resultSummary: null,
    lastActivityAt: '2026-09-26T08:00:00.000Z',
    needsUserAction: false,
    consumerOutcome: { outcome: null, reason: null },
    ...overrides,
  };
}

describe('home presenter', () => {
  it('only selects managed server plans and caps the carousel at three', () => {
    const selected = selectRunningPlanCards([
      plan({ planId: 'draft', planStatus: 'draft' }),
      plan({ planId: 'paused', planStatus: 'paused' }),
      plan({ planId: '1' }),
      plan({ planId: '2', planStatus: 'degraded' }),
      plan({ planId: '3', planStatus: 'blocked' }),
      plan({ planId: '4' }),
    ]);
    expect(selected.map((item) => item.planId)).toEqual(['1', '2', '3']);
  });

  it('does not call an active plan an active execution without execution evidence', () => {
    expect(presentRunningPlan(plan())).toEqual(expect.objectContaining({
      label: '持续跟进',
      summary: expect.stringContaining('不代表此刻存在执行任务'),
    }));
  });

  it('preserves server outcome uncertainty ahead of local status labels', () => {
    expect(presentRunningPlan(plan({
      executionStatus: 'succeeded',
      consumerOutcome: { outcome: 'OUTCOME_UNKNOWN', reason: '外部结果仍待只读回查' },
    }))).toEqual({ label: '结果待核实', tone: 'warning', summary: '外部结果仍待只读回查' });
  });

  it('maps the unchanged nineteen domains into the four V6 display spaces', () => {
    expect(HOME_SPACES.map((item) => item.label)).toEqual(['我的生活', '我的财物', '我的事务', '我的工作']);
    expect(allHomeDomainKeys()).toHaveLength(19);
    expect(new Set(allHomeDomainKeys()).size).toBe(19);
    expect(homeDomainsForSpace('property').map((item) => item.key)).toEqual(['finance', 'housing', 'vehicle', 'device', 'digital_account']);
  });
});
