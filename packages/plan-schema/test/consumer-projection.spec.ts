import { describe, expect, it } from 'vitest';
import { CONSUMER_PROJECTION_VERSION, isConsumerReadinessProjection } from '../src/consumer-projection';

describe('consumer projection contract', () => {
  it('accepts a versioned server projection', () => {
    expect(isConsumerReadinessProjection({
      contractVersion: CONSUMER_PROJECTION_VERSION,
      productReadiness: 'IMPLEMENTED',
      userReadiness: 'NEEDS_PERMISSION',
      title: '等待授权',
      reason: '通知权限已撤销。',
      nextAction: '重新授权',
      actionPath: '/connections',
    })).toBe(true);
  });

  it('rejects unversioned or client-invented readiness', () => {
    expect(isConsumerReadinessProjection({ productReadiness: 'IMPLEMENTED', userReadiness: 'READY' })).toBe(false);
    expect(isConsumerReadinessProjection({
      contractVersion: CONSUMER_PROJECTION_VERSION,
      productReadiness: 'IMPLEMENTED',
      userReadiness: 'CLIENT_READY',
      title: '', reason: '', nextAction: '', actionPath: null,
    })).toBe(false);
  });
});
