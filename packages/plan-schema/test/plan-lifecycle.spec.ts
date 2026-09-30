import { describe, expect, it } from 'vitest';
import {
  PLAN_LIFECYCLE_STEPS,
  buildPlanLifecycleProjection,
  isPlanLifecycleProjection,
} from '../src/plan-lifecycle';

describe('17-step plan lifecycle consumer projection', () => {
  it('contains each outer lifecycle step exactly once without replacing the inner 15-step runtime', () => {
    const projection = buildPlanLifecycleProjection({
      planId: 'plan-1',
      planVersionId: 'version-1',
      scenarioKey: 'daily_life.delivery',
      observations: [
        { key: 'DOMAIN', state: 'COMPLETED', reasonCode: 'DOMAIN_PERSISTED', evidenceRefs: ['version:version-1'] },
        { key: 'READINESS', state: 'BLOCKED', reasonCode: 'NEEDS_PERMISSION', evidenceRefs: [] },
      ],
      evaluatedAt: '2026-09-25T00:00:00.000Z',
    });

    expect(projection.steps).toHaveLength(17);
    expect(new Set(projection.steps.map((item) => item.key))).toHaveLength(17);
    expect(projection.steps.map(({ step, key }) => ({ step, key }))).toEqual(PLAN_LIFECYCLE_STEPS.map(({ step, key }) => ({ step, key })));
    expect(projection.currentStep).toBe(6);
    expect(projection.steps[1]?.state).toBe('NOT_REACHED');
    expect(isPlanLifecycleProjection(projection)).toBe(true);
  });

  it('rejects duplicate evidence instead of guessing which state wins', () => {
    expect(() => buildPlanLifecycleProjection({
      planId: 'plan-1',
      observations: [
        { key: 'READINESS', state: 'READY', reasonCode: 'READY', evidenceRefs: [] },
        { key: 'READINESS', state: 'BLOCKED', reasonCode: 'BLOCKED', evidenceRefs: [] },
      ],
      evaluatedAt: '2026-09-25T00:00:00.000Z',
    })).toThrow('Duplicate plan lifecycle observation');
  });
});
