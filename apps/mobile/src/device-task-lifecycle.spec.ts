import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceTaskRunnerLifecycle } from './device-task-lifecycle';
import type { DeviceTaskRunner } from './device-task-runner';

function makeRunner() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    shutdown: vi.fn(async () => {}),
  } as unknown as DeviceTaskRunner;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DeviceTask runner lifecycle', () => {
  beforeEach(() => vi.resetAllMocks());

  it('starts only when signed in and the device is ready', async () => {
    const runner = makeRunner();
    const assertReady = vi.fn(async () => true);
    const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady });

    await lifecycle.sync(null);
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.shutdown).toHaveBeenCalled();

    await lifecycle.sync('token-a');
    expect(assertReady).toHaveBeenCalledWith('token-a');
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(runner.shutdown).toHaveBeenCalledTimes(1);
  });

  it('does not start when trusted device / device authorization is missing', async () => {
    const runner = makeRunner();
    const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: async () => false });

    await lifecycle.sync('token-a');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('stops on logout and token change', async () => {
    const runner = makeRunner();
    const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: async () => true });

    await lifecycle.sync('token-a');
    await lifecycle.sync('token-b');
    expect(runner.shutdown).toHaveBeenCalled();

    await lifecycle.sync(null);
    expect(runner.shutdown).toHaveBeenCalledTimes(2);
  });

  it('stops when the device authorization disappears', async () => {
    const runner = makeRunner();
    let ready = true;
    const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: async () => ready });

    await lifecycle.sync('token-a');
    expect(runner.start).toHaveBeenCalledTimes(1);

    ready = false;
    await lifecycle.sync('token-a');
    expect(runner.shutdown).toHaveBeenCalled();
  });

  it('stops on background and restarts on foreground when ready', async () => {
    const runner = makeRunner();
    const lifecycle = new DeviceTaskRunnerLifecycle({ runner, assertReady: async () => true });

    await lifecycle.sync('token-a');
    expect(runner.start).toHaveBeenCalledTimes(1);

    lifecycle.onAppState(false);
    expect(runner.stop).toHaveBeenCalled();

    lifecycle.onAppState(true);
    await flush();
    expect(runner.start).toHaveBeenCalledTimes(2);
  });
});
