import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  appReadSessionStatus: vi.fn(),
  captureAppReadUiNodes: vi.fn(),
}));

const client = vi.hoisted(() => ({
  listDeviceTasks: vi.fn(),
  claimDeviceTask: vi.fn(),
  heartbeatClaim: vi.fn(),
  completeDeviceTask: vi.fn(),
  failDeviceTask: vi.fn(),
}));

vi.mock('./device-app-bridge', () => bridge);
vi.mock('./device-task-client', () => client);
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { executeStructuredRead } from './android-structured-read-executor';
import type { DeviceTask } from './device-task-client';
import { DeviceTaskRunner } from './device-task-runner';
import type { RunnerState, RunnerStateStore, StructuredReadResult } from './device-task-runner';

function taskFixture(overrides: Partial<DeviceTask> = {}): DeviceTask {
  return {
    id: 'task-1', trustedDeviceId: 'trusted-1', deviceId: 'device-1', taskType: 'APP_STRUCTURED_READ',
    factKey: 'structured_read.field', resourceType: 'FixtureWallet',
    payload: { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'fixture-1', requestedFields: ['wallet.balance'] },
    status: 'PENDING', claimToken: null, leaseExpiresAt: null, errorCode: null, ...overrides,
  };
}

function readingSession(overrides: Record<string, unknown> = {}) {
  return {
    active: true, sessionId: 'session-1', targetPackage: 'com.lazyarmor.fixture.wallet', status: 'READING',
    expiresAt: Date.now() + 60_000, usageAccessGranted: true, foregroundPackage: 'com.lazyarmor.fixture.wallet',
    pendingEventCount: 0, ...overrides,
  };
}

function store(initial: RunnerState | null) {
  let value = initial;
  const load = vi.fn(async () => value);
  const save = vi.fn(async (next: RunnerState | null) => { value = next; });
  return { load, save } as RunnerStateStore & { load: typeof load; save: typeof save };
}

describe('real Android structured read executor', () => {
  beforeEach(() => vi.resetAllMocks());

  it('fails closed when the package has no registered profile', async () => {
    bridge.appReadSessionStatus.mockResolvedValue(readingSession());
    const result = await executeStructuredRead(taskFixture({ payload: { packageName: 'com.unknown.app', resourceId: 'x', requestedFields: ['wallet.balance'] } }));
    expect(result).toBeNull();
    expect(bridge.captureAppReadUiNodes).not.toHaveBeenCalled();
  });

  it('rejects wildcard and sensitive selectors before any capture', async () => {
    bridge.appReadSessionStatus.mockResolvedValue(readingSession());
    const wildcard = await executeStructuredRead(taskFixture({ payload: { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'fixture-1', requestedFields: ['*'] } }));
    const sensitive = await executeStructuredRead(taskFixture({ payload: { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'fixture-1', requestedFields: ['paymentPassword'] } }));
    expect(wildcard).toBeNull();
    expect(sensitive).toBeNull();
    expect(bridge.captureAppReadUiNodes).not.toHaveBeenCalled();
  });

  it('fails closed when the session is not reading the target package in the foreground', async () => {
    bridge.appReadSessionStatus.mockResolvedValue(readingSession({ status: 'WAITING_FOREGROUND' }));
    const result = await executeStructuredRead(taskFixture());
    expect(result).toBeNull();
    expect(bridge.captureAppReadUiNodes).not.toHaveBeenCalled();
  });

  it('fails closed when native UI-node capture returns no real nodes', async () => {
    bridge.appReadSessionStatus.mockResolvedValue(readingSession());
    bridge.captureAppReadUiNodes.mockResolvedValue(null);
    const result = await executeStructuredRead(taskFixture());
    expect(result).toBeNull();
  });

  it('returns only allowlisted, non-sensitive nodes', async () => {
    bridge.appReadSessionStatus.mockResolvedValue(readingSession());
    bridge.captureAppReadUiNodes.mockResolvedValue({
      nodes: [
        { resourceId: 'wallet.balance', text: '25' },
        { resourceId: 'wallet.balance', contentDescription: 'paymentPassword', text: 'secret' },
        { resourceId: 'transaction.latest.amount', text: '12.50' },
        { resourceId: 'some.other.node', text: 'drop-me' },
      ],
      evidenceHash: null,
    });
    const result = await executeStructuredRead(taskFixture());
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).nodes).toEqual([
      { resourceId: 'wallet.balance', text: '25' },
      { resourceId: 'transaction.latest.amount', text: '12.50' },
    ]);
    expect(result).not.toHaveProperty('verified');
    expect(result).not.toHaveProperty('status');
  });
});

describe('fixture structured read closed loop', () => {
  beforeEach(() => vi.resetAllMocks());

  it('completes the DeviceTask with fixture evidence that is never marked verified', async () => {
    const stateStore = store(null);
    const pending = taskFixture();
    const claimed = { ...pending, status: 'CLAIMED' as const, claimToken: 'a'.repeat(64), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    client.listDeviceTasks.mockResolvedValue([pending]);
    client.claimDeviceTask.mockResolvedValue(claimed);
    client.completeDeviceTask.mockImplementation(async (_token: string, _task: DeviceTask, result: Record<string, unknown>) => ({ ...claimed, status: 'SUCCEEDED', result }));

    const fixtureExecutor = async (task: DeviceTask): Promise<StructuredReadResult> => ({
      packageName: 'com.lazyarmor.fixture.wallet',
      resourceId: task.payload.resourceId as string,
      observedAt: new Date().toISOString(),
      nodes: [{ resourceId: 'wallet.balance', text: '25' }],
    });

    const runner = new DeviceTaskRunner({ token: () => 'token', state: stateStore, executeStructuredRead: fixtureExecutor });
    await runner.tick();

    expect(client.claimDeviceTask).toHaveBeenCalledWith('token', pending);
    expect(client.completeDeviceTask).toHaveBeenCalledTimes(1);
    const result = client.completeDeviceTask.mock.calls[0][2] as Record<string, unknown>;
    expect(result.nodes).toEqual([{ resourceId: 'wallet.balance', text: '25' }]);
    expect(JSON.stringify(result)).not.toMatch(/ANDROID VERIFIED|verified/i);
    expect(await stateStore.load()).toBeNull();
  });
});
