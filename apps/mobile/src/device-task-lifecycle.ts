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
 * and app teardown. An explicitly scoped, already claimed page read may settle
 * during its visible native handoff; background polling never starts.
 */
export class DeviceTaskRunnerLifecycle {
  private started = false;
  private activeToken: string | null = null;
  private foreground = true;
  private checkEpoch = 0;
  private cleanup: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DeviceTaskRunnerLifecycleDeps) {}

  async sync(token: string | null, foreground?: boolean): Promise<void> {
    if (foreground !== undefined) this.foreground = foreground;
    if (!token) {
      await this.shutdown();
      return;
    }
    const changed = Boolean(this.activeToken && this.activeToken !== token);
    const epoch = ++this.checkEpoch;
    this.activeToken = token;
    if (changed) await this.resetRunner();
    else await this.cleanup;
    const current = () => epoch === this.checkEpoch && this.activeToken === token && this.foreground;
    if (!current()) return;
    const ready = await this.deps.assertReady(token);
    if (!current()) return;
    if (ready && !this.started) {
      this.deps.runner.start();
      this.started = true;
    } else if (!ready && this.started) {
      await this.resetRunner();
    }
  }

  onAppState(active: boolean): void {
    this.foreground = active;
    if (active) {
      void this.sync(this.activeToken);
    } else {
      ++this.checkEpoch;
      this.started = false;
      // Stop polling. Only an already leased, explicitly scoped page read may settle.
      this.deps.runner.stop(true);
    }
  }

  stop(): void {
    ++this.checkEpoch;
    this.started = false;
    this.deps.runner.stop();
  }

  async shutdown(): Promise<void> {
    ++this.checkEpoch;
    this.activeToken = null;
    await this.resetRunner();
  }

  private resetRunner(): Promise<void> {
    this.started = false;
    this.deps.runner.stop();
    // A new account/check must wait for the old local claim cleanup to settle.
    const operation = this.cleanup.then(() => this.deps.runner.shutdown());
    this.cleanup = operation.catch(() => {});
    return operation;
  }
}
