import { describe, expect, it } from 'vitest';
import {
  PLAN_EXECUTION_LIFECYCLE,
  buildLifecycleReadProjection,
  isLifecycleReadProjection,
} from '../src';

describe('lifecycle read projection', () => {
  it('always returns the one canonical 15-step read-only projection', () => {
    const projection = buildLifecycleReadProjection();
    expect(projection).toMatchObject({ schemaVersion: '1', readOnly: true });
    expect(projection.steps).toHaveLength(15);
    expect(projection.steps.map(({ step, key, label }) => ({ step, key, label }))).toEqual(PLAN_EXECUTION_LIFECYCLE);
    expect(projection.steps.every((step) => step.state === 'NOT_REACHED' && step.reason === null)).toBe(true);
    expect(isLifecycleReadProjection(projection)).toBe(true);
  });

  it('keeps unknown outcomes explicit and never turns missing stages into success', () => {
    const projection = buildLifecycleReadProjection([
      { key: 'EXECUTION', state: 'OUTCOME_UNKNOWN', reason: 'SIDE_EFFECT_OUTCOME_UNKNOWN' },
      { key: 'VERIFICATION', state: 'UNKNOWN', reason: 'READ_BACK_INCONCLUSIVE' },
    ]);
    expect(projection.steps.find((step) => step.key === 'EXECUTION')).toMatchObject({ state: 'OUTCOME_UNKNOWN' });
    expect(projection.steps.find((step) => step.key === 'VERIFICATION')).toMatchObject({ state: 'UNKNOWN' });
    expect(projection.steps.filter((step) => !['EXECUTION', 'VERIFICATION'].includes(step.key)).every((step) => step.state === 'NOT_REACHED')).toBe(true);
  });

  it('rejects duplicate or invented observations instead of manufacturing events', () => {
    expect(() => buildLifecycleReadProjection([
      { key: 'RESULT', state: 'FAILED' },
      { key: 'RESULT', state: 'SUCCEEDED' },
    ])).toThrow('Duplicate lifecycle observation');
    expect(() => buildLifecycleReadProjection([{ key: 'INVENTED' as never, state: 'SUCCEEDED' }])).toThrow('Unknown lifecycle step');
  });
});
