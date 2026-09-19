import * as SecureStore from 'expo-secure-store';
import { ApiError } from './api';
import {
  claimDeviceTask,
  completeDeviceTask,
  failDeviceTask,
  heartbeatClaim,
  listDeviceTasks,
  type DeviceTask,
} from './device-task-client';

// Runner 只 dispatch 服务器注册表中真正由本机执行的结构化读取类型。
// 其他类型（如 APP_READ_SESSION 由 app-read-session 流程处理）不在此 dispatch。
export const RUNNER_EXECUTABLE_TASK_TYPES = new Set(['APP_STRUCTURED_READ', 'SCREEN_CAPTURE_FOR_READ']);

export interface RunnerState {
  taskId: string;
  claimToken: string;
  leaseExpiresAt: string;
}

export interface RunnerStateStore {
  load(): Promise<RunnerState | null>;
  save(state: RunnerState | null): Promise<void>;
}

export type StructuredReadResult = Record<string, unknown> | null;

export interface StructuredReadExecutor {
  (task: DeviceTask): Promise<StructuredReadResult>;
}

export interface DeviceTaskRunnerOptions {
  token: () => string | null;
  pollIntervalMs?: number;
  leaseSafetyMarginMs?: number;
  keepaliveIntervalMs?: number;
  state?: RunnerStateStore;
  executeStructuredRead?: StructuredReadExecutor;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_LEASE_SAFETY_MARGIN_MS = 5_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 10_000;
const RUNNER_STATE_KEY = 'lazy-armor-device-task-runner-state';

export const secureRunnerStateStore: RunnerStateStore = {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(RUNNER_STATE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isValidRunnerState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async save(state) {
    try {
      if (!state) await SecureStore.deleteItemAsync(RUNNER_STATE_KEY);
      else await SecureStore.setItemAsync(RUNNER_STATE_KEY, JSON.stringify(state));
    } catch {
      // 状态保存是 best-effort；丢失时服务端会按 lease 过期自动恢复任务。
    }
  },
};

/**
 * 真机 DeviceTask 执行闭环：poll -> allowlisted dispatch -> claim -> lease
 * heartbeat（覆盖整个执行周期）-> 本地结构化读取 -> complete/fail。
 * Runner 不写 Truth、不做 Risk/Approval 决策，只把结果交回服务端走 RealityPipeline。
 */
export class DeviceTaskRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight = false;
  private keepaliveInFlight = false;
  private claimEpoch = 0;
  private activeClaim: RunnerState | null = null;
  private keepaliveTask: DeviceTask | null = null;

  constructor(private readonly options: DeviceTaskRunnerOptions) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopKeepalive();
  }

  /** App teardown / logout / device revoke：停止并丢弃本机未完成 claim 状态。 */
  async shutdown() {
    this.stop();
    await this.clearState();
  }

  async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const token = this.options.token();
      if (!token) {
        this.stopKeepalive();
        return;
      }
      if (!this.activeClaim) this.activeClaim = await this.options.state?.load() ?? null;
      if (this.activeClaim) await this.recoverInterruptedClaim(token);
      const tasks = await listDeviceTasks(token);
      const pending = tasks.filter((task) => task.status === 'PENDING' && RUNNER_EXECUTABLE_TASK_TYPES.has(task.taskType));
      if (!pending.length) return;
      await this.claimAndRun(token, pending[0]);
    } finally {
      this.inFlight = false;
    }
  }

  private async recoverInterruptedClaim(token: string) {
    const state = this.activeClaim;
    if (!state) return;
    this.stopKeepalive();
    const leaseActive = Date.parse(state.leaseExpiresAt) > Date.now();
    if (!leaseActive) {
      await this.clearState();
      return;
    }
    // 进程在 claim 后中断，无法恢复未完成的本地采集结果；显式失败以便服务端重新调度。
    await this.failTask(token, runnerStateAsTask(state), 'DEVICE_RUNNER_INTERRUPTED');
  }

  private async claimAndRun(token: string, task: DeviceTask) {
    let claimed: DeviceTask;
    try {
      claimed = await claimDeviceTask(token, task);
    } catch {
      return; // 已被其他设备认领或不可认领，下一轮再 poll。
    }
    await this.persist({ taskId: claimed.id, claimToken: claimed.claimToken!, leaseExpiresAt: claimed.leaseExpiresAt! });
    claimed = await this.heartbeatIfNeeded(token, claimed);
    this.startKeepalive(claimed);

    let result: StructuredReadResult;
    try {
      result = await this.execute(claimed);
    } catch {
      await this.abortActiveClaim(token, 'DEVICE_READ_EXECUTION_FAILED');
      return;
    }
    // keepalive 可能已在执行期间失败并收口该 claim；此时不得再 complete/fail。
    if (!this.keepaliveTask) return;
    if (!result) {
      await this.abortActiveClaim(token, 'DEVICE_READ_UNAVAILABLE');
      return;
    }
    const terminal = this.keepaliveTask;
    try {
      await completeDeviceTask(token, terminal, result);
    } catch (error) {
      this.stopKeepalive();
      await this.clearState();
      // 服务端已拒绝（claim 丢失/已回收/任务不存在）时不再重复失败，交给恢复流程。
      if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 409)) return;
      throw error;
    }
    this.stopKeepalive();
    await this.clearState();
  }

  private async execute(task: DeviceTask): Promise<StructuredReadResult> {
    if (this.options.executeStructuredRead) return this.options.executeStructuredRead(task);
    // 本地尚无 UI-node 采集器时明确回退，绝不伪造节点或写入 Truth。
    return null;
  }

  private startKeepalive(task: DeviceTask) {
    this.stopKeepalive();
    this.claimEpoch += 1;
    const epoch = this.claimEpoch;
    this.keepaliveTask = task;
    const interval = this.options.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
    this.keepaliveTimer = setInterval(() => void this.keepaliveHeartbeat(epoch), interval);
  }

  private stopKeepalive() {
    this.keepaliveTask = null;
    this.claimEpoch += 1; // invalidate any in-flight heartbeat for the old claim
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private async keepaliveHeartbeat(epoch: number) {
    if (this.keepaliveInFlight || epoch !== this.claimEpoch) return;
    const task = this.keepaliveTask;
    if (!task) return;
    const token = this.options.token();
    if (!token) {
      this.stopKeepalive();
      await this.clearState();
      return;
    }
    this.keepaliveInFlight = true;
    try {
      const renewed = await heartbeatClaim(token, task);
      if (epoch !== this.claimEpoch) {
        await this.clearState();
        return;
      }
      const next = { ...task, leaseExpiresAt: renewed.leaseExpiresAt };
      this.keepaliveTask = next;
      await this.persist({ taskId: next.id, claimToken: next.claimToken!, leaseExpiresAt: next.leaseExpiresAt });
    } catch {
      if (epoch !== this.claimEpoch) {
        await this.clearState();
        return;
      }
      const terminal = this.keepaliveTask ?? task;
      this.stopKeepalive();
      await this.failTask(token, terminal, 'DEVICE_RUNNER_HEARTBEAT_FAILED');
    } finally {
      this.keepaliveInFlight = false;
    }
  }

  private async renewLease(token: string, task: DeviceTask): Promise<DeviceTask> {
    const renewed = await heartbeatClaim(token, task);
    const next = { ...task, leaseExpiresAt: renewed.leaseExpiresAt };
    await this.persist({ taskId: next.id, claimToken: next.claimToken!, leaseExpiresAt: next.leaseExpiresAt });
    return next;
  }

  private async heartbeatIfNeeded(token: string, task: DeviceTask): Promise<DeviceTask> {
    if (!task.leaseExpiresAt) return task;
    const margin = this.options.leaseSafetyMarginMs ?? DEFAULT_LEASE_SAFETY_MARGIN_MS;
    if (Date.parse(task.leaseExpiresAt) - Date.now() > margin) return task;
    try {
      return await this.renewLease(token, task);
    } catch {
      // claim 可能已被回收；complete/fail 会以明确拒绝收尾。
      return task;
    }
  }

  private async abortActiveClaim(token: string, errorCode: string) {
    const terminal = this.keepaliveTask;
    if (!terminal) return; // keepalive 已失败并收口，避免重复 fail。
    this.stopKeepalive();
    await this.failTask(token, terminal, errorCode);
  }

  private async failTask(token: string, task: DeviceTask, errorCode: string) {
    try {
      await failDeviceTask(token, task, errorCode);
    } catch {
      // 服务端可能已按 lease 过期回收任务，忽略即可。
    } finally {
      await this.clearState();
    }
  }

  private async persist(state: RunnerState) {
    this.activeClaim = state;
    await this.options.state?.save(state);
  }

  private async clearState() {
    this.activeClaim = null;
    await this.options.state?.save(null);
  }
}

function runnerStateAsTask(state: RunnerState): DeviceTask {
  return {
    id: state.taskId,
    trustedDeviceId: '',
    deviceId: '',
    taskType: 'APP_STRUCTURED_READ',
    factKey: '',
    resourceType: '',
    payload: {},
    status: 'RUNNING',
    claimToken: state.claimToken,
    leaseExpiresAt: state.leaseExpiresAt,
    errorCode: null,
  };
}

function isValidRunnerState(value: unknown): value is RunnerState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RunnerState>;
  return typeof state.taskId === 'string' && state.taskId.length > 0
    && typeof state.claimToken === 'string' && /^[a-f0-9]{64}$/.test(state.claimToken)
    && typeof state.leaseExpiresAt === 'string' && !Number.isNaN(Date.parse(state.leaseExpiresAt));
}
