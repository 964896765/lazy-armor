import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { DeviceTaskRunner } from './device-task-runner';
import type { RunnerState, RunnerStateStore, StructuredReadResult } from './device-task-runner';
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('keeps the lease alive across the execution window, persists the renewed lease, and completes', async () => {
    const stateStore = store(null);
    const claimed = claimedTask({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);

    const renewedLease = new Date(Date.now() + 120_000).toISOString();
    let signalHeartbeat: () => void = () => {};
    const heartbeatSignal = new Promise<void>((resolve) => { signalHeartbeat = resolve; });
    mocks.heartbeatClaim.mockImplementation(async () => { signalHeartbeat(); return { leaseExpiresAt: renewedLease }; });

    let release: (value: StructuredReadResult) => void = () => {};
    const execute = vi.fn(() => new Promise<StructuredReadResult>((resolve) => { release = resolve; }));
    mocks.completeDeviceTask.mockImplementation(async (_token: string, task: DeviceTask) => ({ ...task, status: 'SUCCEEDED' }));

    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: execute, keepaliveIntervalMs: 5 });
    const tickPromise = runner.tick();
    await heartbeatSignal;
    await flush();

    expect(mocks.heartbeatClaim).toHaveBeenCalled();
    expect(stateStore.save).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', leaseExpiresAt: renewedLease }));

    release({ nodes: [] });
    await tickPromise;

    expect(mocks.completeDeviceTask).toHaveBeenCalledWith('token', expect.objectContaining({ leaseExpiresAt: renewedLease }), expect.anything());
    expect(await stateStore.load()).toBeNull();
  });

  it('fails, stops, and cleans up when a keepalive heartbeat fails', async () => {
    const stateStore = store(null);
    const claimed = claimedTask({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    let signalHeartbeat: () => void = () => {};
    const heartbeatSignal = new Promise<void>((resolve) => { signalHeartbeat = resolve; });
    mocks.heartbeatClaim.mockImplementation(async () => { signalHeartbeat(); throw new Error('network down'); });
    mocks.failDeviceTask.mockResolvedValue({ status: 'FAILED' });
    let release: (value: StructuredReadResult) => void = () => {};
    const execute = vi.fn(() => new Promise<StructuredReadResult>((resolve) => { release = resolve; }));

    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: execute, keepaliveIntervalMs: 5 });
    const tickPromise = runner.tick();
    await heartbeatSignal;
    await flush();

    expect(mocks.failDeviceTask).toHaveBeenCalledWith('token', expect.objectContaining({ id: 'task-1' }), 'DEVICE_RUNNER_HEARTBEAT_FAILED');
    expect(await stateStore.load()).toBeNull();

    release({ nodes: [] });
    await tickPromise;
    expect(mocks.completeDeviceTask).not.toHaveBeenCalled();
  });

  it('stops and cleans up without double-failing when the claim is lost during keepalive', async () => {
    const stateStore = store(null);
    const claimed = claimedTask({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    let signalHeartbeat: () => void = () => {};
    const heartbeatSignal = new Promise<void>((resolve) => { signalHeartbeat = resolve; });
    mocks.heartbeatClaim.mockImplementation(async () => { signalHeartbeat(); throw new ApiError(409, 'CONFLICT', 'claim lost'); });
    mocks.failDeviceTask.mockRejectedValue(new ApiError(409, 'CONFLICT', 'claim lost'));
    let release: (value: StructuredReadResult) => void = () => {};
    const execute = vi.fn(() => new Promise<StructuredReadResult>((resolve) => { release = resolve; }));

    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: execute, keepaliveIntervalMs: 5 });
    const tickPromise = runner.tick();
    await heartbeatSignal;
    await flush();

    expect(mocks.failDeviceTask).toHaveBeenCalledWith('token', expect.objectContaining({ id: 'task-1' }), 'DEVICE_RUNNER_HEARTBEAT_FAILED');
    expect(await stateStore.load()).toBeNull();

    release({ nodes: [] });
    await tickPromise;
    expect(mocks.completeDeviceTask).not.toHaveBeenCalled();
  });

  it('clears the keepalive timer when the runner is stopped', async () => {
    const stateStore = store(null);
    const claimed = claimedTask({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
    mocks.listDeviceTasks.mockResolvedValue([makeTask()]);
    mocks.claimDeviceTask.mockResolvedValue(claimed);
    let started: () => void = () => {};
    const startedSignal = new Promise<void>((resolve) => { started = resolve; });
    let release: (value: StructuredReadResult) => void = () => {};
    const execute = vi.fn(() => { started(); return new Promise<StructuredReadResult>((resolve) => { release = resolve; }); });

    const runner = new DeviceTaskRunner({ token, state: stateStore, executeStructuredRead: execute, keepaliveIntervalMs: 5 });
    const tickPromise = runner.tick();
    await startedSignal;
    runner.stop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(mocks.heartbeatClaim).not.toHaveBeenCalled();

    release({ nodes: [] });
    await tickPromise;
    expect(mocks.completeDeviceTask).not.toHaveBeenCalled();
  });
});
