import { describe, expect, it } from 'vitest';
import { PLAN_EXECUTION_LIFECYCLE, buildLifecycleReadProjection } from '@lazy-armor/plan-schema/mobile';
import {
  capabilityDimensionLabel,
  capabilityGapCopy,
  lifecycleStateDetail,
  lifecycleStateLabel,
  readinessReasonCopy,
  reconciliationSafetyCopy,
  runtimeResultCopy,
  stateActionCopy,
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
    expect(lifecycleStateLabel('OUTCOME_UNKNOWN')).toBe('结果待确认');
    expect(runtimeResultCopy('OUTCOME_UNKNOWN')).toBe('结果待确认');
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

  it('turns readiness blockers into consumer language instead of raw codes', () => {
    expect(readinessReasonCopy('REQUIRED_FACTS_UNAVAILABLE')).toContain('缺数据');
    expect(readinessReasonCopy('REQUIRED_CAPABILITIES_UNUSABLE')).toContain('缺授权');
    expect(stateActionCopy('BLOCKED_PROVIDER')).toContain('连接');
    expect(stateActionCopy('AUTOMATED_READY')).toContain('自动');
  });

  it('explains device offline and provider health in plain language', () => {
    expect(capabilityGapCopy(['CAPABILITY_HEALTH_DEVICE_OFFLINE'])).toContain('设备离线');
    expect(capabilityGapCopy(['CAPABILITY_HEALTH_PROVIDER_UNAVAILABLE'])).toContain('服务方暂时不可用');
    expect(capabilityGapCopy(['CAPABILITY_GRANT_EXPIRED'])).toContain('重新连接');
  });
});
