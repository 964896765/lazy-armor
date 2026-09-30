import { describe, expect, it } from 'vitest';
import { filterServiceProjections, isServiceTabDoubleTap, matchesServiceCategory } from './service-filters';
import type { ServicePlanProjection } from './service-presenter';

const plans: ServicePlanProjection[] = [
  { id: 'clean', status: 'active', name: '日常保洁', templateKey: 'family-clean', currentVersion: null, latestExecution: { id: 'e1', status: 'running', resultSummary: null, createdAt: '2026-09-30' } },
  { id: 'waiting', status: 'active', name: '家庭补给', templateKey: 'family-supply', currentVersion: null, latestExecution: { id: 'e2', status: 'waiting_approval', resultSummary: null, createdAt: '2026-09-30' } },
  { id: 'done', status: 'completed', name: '网站开发', templateKey: 'website-development', currentVersion: null, latestExecution: null },
];

describe('service filters', () => {
  it('opens only after two taps on the same tab within the time window', () => {
    expect(isServiceTabDoubleTap({ section: 'recommended', at: 1000 }, 'recommended', 1300)).toBe(true);
    expect(isServiceTabDoubleTap({ section: 'recommended', at: 1000 }, 'following', 1300)).toBe(false);
    expect(isServiceTabDoubleTap({ section: 'recommended', at: 1000 }, 'recommended', 1400)).toBe(false);
  });

  it('filters real plan categories and recorded execution status', () => {
    expect(filterServiceProjections(plans, 'recommended', 'development').map((plan) => plan.id)).toEqual(['done']);
    expect(filterServiceProjections(plans, 'active', 'waiting').map((plan) => plan.id)).toEqual(['waiting']);
    expect(filterServiceProjections(plans, 'active', 'completed').map((plan) => plan.id)).toEqual(['done']);
    expect(matchesServiceCategory('日常保洁', 'life')).toBe(true);
  });

  it('does not synthesize location, follow or payment results from plan data', () => {
    expect(filterServiceProjections(plans, 'nearby', '1km')).toEqual([]);
    expect(filterServiceProjections(plans, 'following', 'followed')).toEqual([]);
    expect(filterServiceProjections(plans, 'active', 'payment')).toEqual([]);
  });
});
