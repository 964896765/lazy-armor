import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { DeviceTaskRunner } from './device-task-runner';
import type { RunnerState, RunnerStateStore } from './device-task-runner';
import type { DeviceTask } from './device-task-client';

const mocks = vi.hoisted(() => ({
  listDeviceTasks: vi.fn(),
  claimDeviceTask: vi.fn(),
  heartbeatClaim: vi.fn(),
  completeDeviceTask: vi.fn(),
  failDeviceTask: vi.fn(),
}));

vi.mock('./device-task-client', () => mocks);
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const token = () => 'token';

function makeTask(overrides: Partial<DeviceTask> = {}): DeviceTask {
  return {
    id: 'task-1', trustedDeviceId: 'trusted-1', deviceId: 'device-1', taskType: 'APP_STRUCTURED_READ',
    factKey: 'structured_read.field', resourceType: 'FixtureWallet', payload: {}, status: 'PENDING',
    claimToken: null, leaseExpiresAt: null, errorCode: null, ...overrides,
  };
}

function claimedTask(overrides: Partial<DeviceTask> = {}): DeviceTask {
  return makeTask({
    status: 'CLAIMED', claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides,
  });
}

function store(initial: RunnerState | null) {
  let value = initial;
  const load = vi.fn(async () => value);
  const save = vi.fn(async (next: RunnerState | null) => { value = next; });
  return { load, save } as RunnerStateStore & { load: typeof load; save: typeof save };
}

describe('mobile DeviceTask runner', () => {
  beforeEach(() => vi.resetAllMocks());

  it('fails an interrupted claim and clears persisted state on recovery', async () => {
    const stateStore = store({ taskId: 'task-1', claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([]);
    mocks.failDeviceTask.mockResolvedValue({ status: 'FAILED' });
    const runner = new DeviceTaskRunner({ token, state: stateStore });

    await runner.tick();

    expect(mocks.failDeviceTask).toHaveBeenCalledWith('token', expect.objectContaining({ id: 'task-1', claimToken: 'a'.repeat(64) }), 'DEVICE_RUNNER_INTERRUPTED');
    expect(await stateStore.load()).toBeNull();
  });

  it('clears an expired interrupted claim without failing it', async () => {
    const stateStore = store({ taskId: 'task-1', claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([]);
    const runner = new DeviceTaskRunner({ token, state: stateStore });

    await runner.tick();

    expect(mocks.failDeviceTask).not.toHaveBeenCalled();
    expect(await stateStore.load()).toBeNull();
  });

  it('claims and completes an executable APP_STRUCTURED_READ task', async () => {
    const stateStore = store(null);
    const pending = makeTask();
    const claimed = claimedTask();
    mocks.listDeviceTasks.mockResolvedValue([pending]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    mocks.completeDeviceTask.mockResolvedValue({ ...claimed, status: 'SUCCEEDED' });
    const execute = vi.fn(async () => ({ packageName: 'com.lazyarmor.fixture.wallet', nodes: [{ resourceId: 'wallet.balance', text: '25' }] }));
    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: execute });

    await runner.tick();

    expect(mocks.claimDeviceTask).toHaveBeenCalledWith('token', pending);
    expect(execute).toHaveBeenCalledWith(claimed);
    expect(mocks.completeDeviceTask).toHaveBeenCalledWith('token', claimed, expect.objectContaining({ nodes: expect.any(Array) }));
    expect(await stateStore.load()).toBeNull();
  });

  it('does not dispatch non-executable task types', async () => {
    const stateStore = store(null);
    mocks.listDeviceTasks.mockResolvedValue([makeTask({ taskType: 'READ_CONSUMABLE' })]);
    const runner = new DeviceTaskRunner({ token, state: stateStore });

    await runner.tick();

    expect(mocks.claimDeviceTask).not.toHaveBeenCalled();
  });

  it('fails with DEVICE_READ_UNAVAILABLE when no local reader is available', async () => {
    const stateStore = store(null);
    const claimed = claimedTask();
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    mocks.failDeviceTask.mockResolvedValue({ status: 'FAILED' });
    const runner = new DeviceTaskRunner({ token, state: stateStore });

    await runner.tick();

    expect(mocks.failDeviceTask).toHaveBeenCalledWith('token', claimed, 'DEVICE_READ_UNAVAILABLE');
    expect(mocks.completeDeviceTask).not.toHaveBeenCalled();
    expect(await stateStore.load()).toBeNull();
  });

  it('does not double-fail when completion is rejected by the server', async () => {
    const stateStore = store(null);
    const claimed = claimedTask();
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    mocks.completeDeviceTask.mockRejectedValue(new ApiError(409, 'CONFLICT', 'claim lost'));
    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: async () => ({ nodes: [] }) });

    await runner.tick();

    expect(mocks.failDeviceTask).not.toHaveBeenCalled();
    expect(await stateStore.load()).toBeNull();
  });

  it('renews the lease before executing when it is close to expiry', async () => {
    const stateStore = store(null);
    const claimed = claimedTask({ leaseExpiresAt: new Date(Date.now() + 1_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    mocks.heartbeatClaim.mockResolvedValue({ leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    mocks.completeDeviceTask.mockResolvedValue({ ...claimed, status: 'SUCCEEDED' });
    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: async () => ({ nodes: [] }) });

    await runner.tick();

    expect(mocks.heartbeatClaim).toHaveBeenCalledWith('token', claimed);
    expect(mocks.completeDeviceTask).toHaveBeenCalled();
  });
});
