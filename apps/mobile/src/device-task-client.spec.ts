import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deviceBoundApi: vi.fn(),
  ensureTrustedDevice: vi.fn(async () => ({ id: 'trusted-1', deviceId: 'device-1' })),
}));

vi.mock('./trusted-device-api', () => mocks);

import { claimDeviceTask, completeDeviceTask, heartbeatClaim, heartbeatDevice, listDeviceTasks } from './device-task-client';
import type { DeviceTask } from './device-task-client';

const task = (overrides: Partial<DeviceTask> = {}): DeviceTask => ({
  id: 'task-1', trustedDeviceId: 'trusted-1', deviceId: 'device-1', taskType: 'APP_STRUCTURED_READ',
  factKey: 'structured_read.field', resourceType: 'example', payload: {}, status: 'PENDING',
  claimToken: null, leaseExpiresAt: null, errorCode: null, ...overrides,
});

describe('signed mobile DeviceTask client', () => {
  beforeEach(() => vi.resetAllMocks());

  it('signs a bodyless GET and exposes only tasks for this device', async () => {
    mocks.ensureTrustedDevice.mockResolvedValue({ id: 'trusted-1', deviceId: 'device-1' });
    mocks.deviceBoundApi.mockResolvedValue([task(), task({ id: 'other', deviceId: 'device-2' })]);
    expect(await listDeviceTasks('token')).toEqual([task()]);
    expect(mocks.deviceBoundApi).toHaveBeenCalledWith('/device-tasks', 'token', { method: 'GET' });
  });

  it('rejects a task assigned to another device before claiming', async () => {
    mocks.ensureTrustedDevice.mockResolvedValue({ id: 'trusted-1', deviceId: 'device-1' });
    await expect(claimDeviceTask('token', task({ deviceId: 'device-2' }))).rejects.toThrow('DEVICE_TASK_WRONG_DEVICE');
    expect(mocks.deviceBoundApi).not.toHaveBeenCalled();
  });

  it('sends heartbeat, claim and completion through signed requests', async () => {
    mocks.ensureTrustedDevice.mockResolvedValue({ id: 'trusted-1', deviceId: 'device-1' });
    const claimed = task({ status: 'CLAIMED', claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
    mocks.deviceBoundApi.mockResolvedValueOnce({ online: true }).mockResolvedValueOnce(claimed).mockResolvedValueOnce({ leaseExpiresAt: claimed.leaseExpiresAt }).mockResolvedValueOnce({ status: 'SUCCEEDED' });
    await heartbeatDevice('token');
    expect(await claimDeviceTask('token', task())).toEqual(claimed);
    await heartbeatClaim('token', claimed);
    await completeDeviceTask('token', claimed, { evidence: 'read-back' });
    expect(mocks.deviceBoundApi.mock.calls.map((call) => call[0])).toEqual([
      '/device-tasks/heartbeat', '/device-tasks/task-1/claim', '/device-tasks/task-1/heartbeat', '/device-tasks/task-1/complete',
    ]);
  });

  it('never submits stale completion or an unclaimed task', async () => {
    await expect(completeDeviceTask('token', task(), {})).rejects.toThrow('DEVICE_TASK_CLAIM_REQUIRED');
    await expect(completeDeviceTask('token', task({ status: 'CLAIMED', claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() - 1).toISOString() }), {})).rejects.toThrow('DEVICE_TASK_LEASE_EXPIRED');
    expect(mocks.deviceBoundApi).not.toHaveBeenCalled();
  });
});
