import { describe, expect, it } from 'vitest';
import type { DeviceTaskEvidence } from './device-task-client';
import { deviceTaskStages, deviceTaskStatusLabel, leaseState } from './device-task-presenter';

const evidence = (overrides: Partial<DeviceTaskEvidence['task']> = {}): DeviceTaskEvidence => ({
  task: { id: 'task-1', taskType: 'APP_STRUCTURED_READ', resourceType: 'account', factKey: 'account.balance', status: 'PENDING', errorCode: null, attemptCount: 0, claimedAt: null, leaseExpiresAt: null, resultHash: null, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', completedAt: null, deviceOnline: false, deviceHeartbeatAt: null, ...overrides },
  observations: [], candidates: [], truths: [], readEvidence: [],
});

describe('device task presenter', () => {
  it('keeps an unclaimed task at the waiting-for-phone stage', () => {
    const stages = deviceTaskStages(evidence());
    expect(stages.find((stage) => stage.key === 'queued')?.state).toBe('current');
    expect(deviceTaskStatusLabel('PENDING')).toBe('等待手机领取');
  });

  it('shows failed completion without claiming evidence exists', () => {
    const stages = deviceTaskStages(evidence({ status: 'FAILED', attemptCount: 2, errorCode: 'DEVICE_READ_TIMEOUT' }));
    expect(stages.find((stage) => stage.key === 'evidence')?.state).toBe('failed');
    expect(stages.find((stage) => stage.key === 'complete')?.detail).toBe('DEVICE_READ_TIMEOUT');
  });

  it('evaluates lease expiry deterministically', () => {
    expect(leaseState('2026-09-23T00:00:00.000Z', Date.parse('2026-09-23T00:00:01.000Z'))).toBe('租约已过期');
    expect(leaseState(null)).toBe('没有活动租约');
  });
});
