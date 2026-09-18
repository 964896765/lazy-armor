import { describe, expect, it } from 'vitest';
import { PLAN_EXECUTION_LIFECYCLE, buildLifecycleReadProjection } from '@lazy-armor/plan-schema/mobile';
import {
  capabilityDimensionLabel,
  lifecycleStateDetail,
  lifecycleStateLabel,
  reconciliationSafetyCopy,
  runtimeResultCopy,
} from './runtime-details-presenter';

describe('runtime details presenter', () => {
  it('presents all canonical 15 steps without changing the shared ordering', () => {
    const projection = buildLifecycleReadProjection();
    expect(projection.steps).toHaveLength(15);
    expect(projection.steps.map((step) => step.key)).toEqual(PLAN_EXECUTION_LIFECYCLE.map((step) => step.key));
    expect(projection.steps.map((step) => lifecycleStateLabel(step.state))).toEqual(Array(15).fill('尚未到达'));
  });

  it('keeps UNKNOWN and OUTCOME_UNKNOWN distinct and explicit', () => {
    expect(lifecycleStateLabel('UNKNOWN')).toBe('状态未知');
    expect(lifecycleStateDetail('UNKNOWN')).toContain('没有足够证据');
    expect(lifecycleStateLabel('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
    expect(runtimeResultCopy('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
  });

  it('states reconciliation is lookup-only and must not resend the original action', () => {
    const copy = reconciliationSafetyCopy();
    expect(copy).toContain('只读回查');
    expect(copy).toContain('不会重发原动作');
  });

  it('presents the four capability dimensions independently', () => {
    expect(capabilityDimensionLabel('providerAvailability', 'AVAILABLE')).toBe('可用');
    expect(capabilityDimensionLabel('implementation', 'NOT_IMPLEMENTED')).toBe('未实现');
    expect(capabilityDimensionLabel('grant', 'UNKNOWN')).toBe('未知');
    expect(capabilityDimensionLabel('health', 'DEGRADED')).toBe('降级');
  });
});
