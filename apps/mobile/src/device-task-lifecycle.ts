import type { DeviceTaskRunner } from './device-task-runner';

export interface DeviceTaskRunnerLifecycleDeps {
  runner: DeviceTaskRunner;
  /** Returns true when the runner may start: signed in + trusted device active + device authorization exists. */
  assertReady: (token: string) => Promise<boolean>;
}

/**
 * Foreground-only lifecycle wiring for the DeviceTask runner. It starts the
 * runner only when every gate passes and stops it (clearing the keepalive timer)
 * on logout, token change, device revoke / authorization loss, app background,
 * and app teardown. It never starts background polling.
 */
export class DeviceTaskRunnerLifecycle {
  private started = false;
  private activeToken: string | null = null;

  constructor(private readonly deps: DeviceTaskRunnerLifecycleDeps) {}

  async sync(token: string | null): Promise<void> {
    if (!token) {
      await this.shutdown();
      return;
    }
    if (this.activeToken && this.activeToken !== token) {
      await this.shutdown();
    }
    this.activeToken = token;
    const ready = await this.deps.assertReady(token);
    if (ready && !this.started) {
      this.deps.runner.start();
      this.started = true;
    } else if (!ready && this.started) {
      await this.deps.runner.shutdown();
      this.started = false;
    }
  }

  onAppState(active: boolean): void {
    if (active) {
      void this.sync(this.activeToken);
    } else {
      this.stop();
    }
  }

  stop(): void {
    this.started = false;
    this.deps.runner.stop();
  }

  async shutdown(): Promise<void> {
    this.started = false;
    this.activeToken = null;
    await this.deps.runner.shutdown();
  }
}
