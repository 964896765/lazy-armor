import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError } from './api';
import {
  claimDeviceTask,
  completeDeviceTask,
  failDeviceTask,
  heartbeatClaim,
  heartbeatDevice,
  listDeviceTasks,
  type DeviceTask,
} from './device-task-client';

// Runner 只 dispatch 服务器注册表中真正由本机执行的结构化读取类型。
// 其他类型（如 APP_READ_SESSION 由 app-read-session 流程处理）不在此 dispatch。
export const RUNNER_EXECUTABLE_TASK_TYPES = new Set(['APP_STRUCTURED_READ', 'SCREEN_CAPTURE_FOR_READ', 'NATIVE_CALENDAR_READ', 'NATIVE_NOTIFICATION_READ', 'NATIVE_CALENDAR_CREATE', 'NATIVE_CALENDAR_WRITE']);

export interface RunnerState {
  claimedTask?:DeviceTask;
  taskId: string;
  claimToken: string;
  leaseExpiresAt: string;
  completedRead?: { task: DeviceTask; result: Record<string, unknown> };
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

// Results may exceed SecureStore limits. Private versioned files commit by rename;
// a failed write must prevent sending an unretained result.
let stateSequence = 0;
let stateWrites: Promise<void> = Promise.resolve();
function stateDirectory() {
  if (!FileSystem.documentDirectory) throw new Error('DEVICE_RESULT_STORAGE_UNAVAILABLE');
  return `${FileSystem.documentDirectory}device-task-runner/`;
}
export const secureRunnerStateStore: RunnerStateStore = {
  async load() {
    await stateWrites;
    const root = stateDirectory();
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    const names = (await FileSystem.readDirectoryAsync(root)).filter(n => /^\d{16}\.json$/.test(n)).sort().reverse();
    if (names.length) {
      stateSequence = Math.max(stateSequence, Number(names[0].slice(0, -5)));
      const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(root + names[0]));
      if (parsed === null) return null;
      if (!isValidRunnerState(parsed)) throw new Error('DEVICE_RESULT_STORAGE_INVALID');
      return parsed;
    }
    // Compatibility for previously retained claim-only state.
    const raw = await SecureStore.getItemAsync(RUNNER_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidRunnerState(parsed)) throw new Error('DEVICE_RESULT_STORAGE_INVALID');
    return parsed;
  },
  save(state) {
    const operation = stateWrites.then(async () => {
    const root = stateDirectory();
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    stateSequence = Math.max(stateSequence + 1, Date.now() * 1000);
    const name = String(stateSequence).padStart(16, '0') + '.json';
    await FileSystem.writeAsStringAsync(root + name + '.part', JSON.stringify(state));
    await FileSystem.moveAsync({ from: root + name + '.part', to: root + name });
    const old = (await FileSystem.readDirectoryAsync(root)).filter(n => /^\d{16}\.json$/.test(n)).sort().reverse().slice(state === null ? 1 : 2);
    for (const file of old) await FileSystem.deleteAsync(root + file, { idempotent: true });
    await SecureStore.deleteItemAsync(RUNNER_STATE_KEY);
    });
    stateWrites = operation.catch(() => {});
    return operation;
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
    void this.tick().catch(() => {});
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
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
      // Device presence is independent of a task lease, including idle polling.
      // Only a successful signed request establishes current device presence.
      await heartbeatDevice(token);
      if (!this.activeClaim) this.activeClaim = await this.options.state?.load() ?? null;
      if (this.activeClaim) {
        await this.recoverInterruptedClaim(token);
        if (this.activeClaim) return; // A retained result must settle before another claim.
      }
      const tasks = await listDeviceTasks(token);
      const pending = tasks.filter((task) => task.status === 'PENDING' && RUNNER_EXECUTABLE_TASK_TYPES.has(task.taskType));
      if (!pending.length) return;
      // A fenced historical task can remain visible. It must not starve current
      // work; each candidate still passes the server's own claim authority.
      for (const task of pending) {
        if (await this.claimAndRun(token, task)) break;
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async recoverInterruptedClaim(token: string) {
    const state = this.activeClaim;
    if (!state) return;
    this.stopKeepalive();
    if (state.completedRead) {
      // Even after lease expiry the server may have committed before losing its reply.
      await this.submitRetainedResult(token, state.completedRead.task, state.completedRead.result);
      return;
    }
    const leaseActive = Date.parse(state.leaseExpiresAt) > Date.now();
    if(state.claimedTask&&['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(state.claimedTask.taskType)&&leaseActive){
      const renewed=await this.renewLease(token,state.claimedTask);
      await this.runClaimedTask(token,renewed);
      return;
    }
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
    } catch (error) {
      // Only an explicit authority/conflict rejection skips this candidate.
      // Transport/authentication failures stop this poll instead of fanning out.
      return !(error instanceof ApiError && [403,409].includes(error.status));
    }
    await this.persist({ taskId: claimed.id, claimToken: claimed.claimToken!, leaseExpiresAt: claimed.leaseExpiresAt!,...(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(claimed.taskType)?{claimedTask:claimed}:{}) });
    await this.runClaimedTask(token,claimed);
    return true;
  }
  private async runClaimedTask(token:string,claimed:DeviceTask){
    if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(claimed.taskType))claimed=await this.renewLease(token,claimed);
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
    this.stopKeepalive();
    // Persist before transmission, and never execute this retained read again.
    await this.persist({ taskId: terminal.id, claimToken: terminal.claimToken!, leaseExpiresAt: terminal.leaseExpiresAt!, completedRead: { task: terminal, result } });
    await this.submitRetainedResult(token, terminal, result);
  }

  private async submitRetainedResult(token: string, task: DeviceTask, result: Record<string, unknown>) {
    if(this.options.token()!==token)return;
    try {
      await completeDeviceTask(token, task, result);
    } catch (error) {
      // Definitive authority/payload rejection fences this receipt; transport and
      // server failures keep the exact result for a new signed request on retry.
      if ((error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) || (error instanceof Error && error.message==='DEVICE_TASK_WRONG_DEVICE')) await this.clearState();
      return;
    }
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
      if (epoch !== this.claimEpoch) return; // Obsolete heartbeat cannot erase a retained result.
      const next = { ...task, leaseExpiresAt: renewed.leaseExpiresAt,...(renewed.dispatchAuthorization?{dispatchAuthorization:renewed.dispatchAuthorization}:{}) };
      this.keepaliveTask = next;
      await this.persist({ taskId: next.id, claimToken: next.claimToken!, leaseExpiresAt: next.leaseExpiresAt,...(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(next.taskType)?{claimedTask:next}:{}) });
    } catch {
      if (epoch !== this.claimEpoch) return; // Obsolete heartbeat cannot erase a retained result.
      const terminal = this.keepaliveTask ?? task;
      this.stopKeepalive();
      await this.failTask(token, terminal, 'DEVICE_RUNNER_HEARTBEAT_FAILED');
    } finally {
      this.keepaliveInFlight = false;
    }
  }

  private async renewLease(token: string, task: DeviceTask): Promise<DeviceTask> {
    const renewed = await heartbeatClaim(token, task);
    const next = { ...task, leaseExpiresAt: renewed.leaseExpiresAt,...(renewed.dispatchAuthorization?{dispatchAuthorization:renewed.dispatchAuthorization}:{}) };
    await this.persist({ taskId: next.id, claimToken: next.claimToken!, leaseExpiresAt: next.leaseExpiresAt,...(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(next.taskType)?{claimedTask:next}:{}) });
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
    await this.options.state?.save(state);
    this.activeClaim = state;
  }

  private async clearState() {
    await this.options.state?.save(null);
    this.activeClaim = null;
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
    && typeof state.leaseExpiresAt === 'string' && !Number.isNaN(Date.parse(state.leaseExpiresAt))
    && (state.completedRead === undefined || Boolean(state.completedRead
      && state.completedRead.task?.id === state.taskId
      && state.completedRead.task?.claimToken === state.claimToken
      && RUNNER_EXECUTABLE_TASK_TYPES.has(state.completedRead.task?.taskType)
      && state.completedRead.result && typeof state.completedRead.result === 'object'
      && !Array.isArray(state.completedRead.result)));
}
