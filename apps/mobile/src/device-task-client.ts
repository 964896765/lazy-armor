import { deviceBoundApi, ensureTrustedDevice } from './trusted-device-api';

export type DeviceTaskStatus = 'PENDING' | 'CLAIMED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'AWAITING_DEVICE_EVIDENCE';

export interface DeviceTask {
  id: string;
  trustedDeviceId: string;
  deviceId: string;
  taskType: string;
  factKey: string;
  resourceType: string;
  payload: Record<string, unknown>;
  status: DeviceTaskStatus;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  errorCode: string | null;
}

export interface DeviceTaskEvidence {
  task: {
    id: string; taskType: string; resourceType: string; factKey: string; status: DeviceTaskStatus; errorCode: string | null;
    attemptCount: number; claimedAt: string | null; leaseExpiresAt: string | null; resultHash: string | null;
    createdAt: string; updatedAt: string; completedAt: string | null; deviceOnline: boolean; deviceHeartbeatAt: string | null;
  };
  observations: Array<{ id: string; status: string; observedAt: string }>;
  candidates: Array<{ id: string; observationId: string; status: string }>;
  truths: Array<{ id: string; status: string; current: boolean }>;
  readEvidence: Array<{ id: string; status: string; blockedReason: string | null }>;
}

const CLAIM_TOKEN = /^[a-f0-9]{64}$/;

export async function heartbeatDevice(token: string, onlineState: 'online' | 'offline' | 'unknown' = 'online') {
  return deviceBoundApi<{ online: boolean; lastHeartbeatAt: string }>('/device-tasks/heartbeat', token, {
    method: 'POST', body: JSON.stringify({ onlineState }),
  });
}

export async function listDeviceTasks(token: string): Promise<DeviceTask[]> {
  const device = await ensureTrustedDevice(token);
  const tasks = await deviceBoundApi<DeviceTask[]>('/device-tasks', token, { method: 'GET' });
  return tasks.filter((task) => task.deviceId === device.deviceId && task.trustedDeviceId === device.id);
}

export async function getDeviceTaskEvidence(token: string, taskId: string): Promise<DeviceTaskEvidence> {
  const device = await ensureTrustedDevice(token);
  const evidence = await deviceBoundApi<DeviceTaskEvidence>(`/device-tasks/${encodeURIComponent(taskId)}/evidence`, token, { method: 'GET' });
  // The endpoint is signed and scoped server-side; the list check also prevents
  // accidentally rendering a task from a different local device after rotation.
  const tasks = await listDeviceTasks(token);
  if (!tasks.some((task) => task.id === evidence.task.id && task.deviceId === device.deviceId && task.trustedDeviceId === device.id)) {
    throw new Error('DEVICE_TASK_WRONG_DEVICE');
  }
  return evidence;
}

export async function claimDeviceTask(token: string, task: DeviceTask): Promise<DeviceTask> {
  if (task.status !== 'PENDING') throw new Error('DEVICE_TASK_NOT_PENDING');
  const device = await ensureTrustedDevice(token);
  if (task.deviceId !== device.deviceId || task.trustedDeviceId !== device.id) throw new Error('DEVICE_TASK_WRONG_DEVICE');
  const claimed = await deviceBoundApi<DeviceTask>(`/device-tasks/${encodeURIComponent(task.id)}/claim`, token, { method: 'POST', body: '{}' });
  if (claimed.status !== 'CLAIMED' || !claimed.claimToken || !CLAIM_TOKEN.test(claimed.claimToken) || !claimed.leaseExpiresAt) throw new Error('DEVICE_TASK_CLAIM_INVALID');
  return claimed;
}

export async function heartbeatClaim(token: string, task: DeviceTask) {
  assertActiveClaim(task);
  return deviceBoundApi<{ leaseExpiresAt: string }>(`/device-tasks/${encodeURIComponent(task.id)}/heartbeat`, token, {
    method: 'POST', body: JSON.stringify({ claimToken: task.claimToken }),
  });
}

export async function completeDeviceTask(token: string, task: DeviceTask, result: Record<string, unknown>) {
  assertActiveClaim(task);
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error('DEVICE_TASK_RESULT_INVALID');
  return deviceBoundApi<DeviceTask>(`/device-tasks/${encodeURIComponent(task.id)}/complete`, token, {
    method: 'POST', body: JSON.stringify({ claimToken: task.claimToken, result }),
  });
}

export async function failDeviceTask(token: string, task: DeviceTask, errorCode: string) {
  assertActiveClaim(task);
  if (!/^[A-Z][A-Z0-9_]{0,119}$/.test(errorCode)) throw new Error('DEVICE_TASK_ERROR_CODE_INVALID');
  return deviceBoundApi<DeviceTask>(`/device-tasks/${encodeURIComponent(task.id)}/fail`, token, {
    method: 'POST', body: JSON.stringify({ claimToken: task.claimToken, errorCode }),
  });
}

function assertActiveClaim(task: DeviceTask) {
  if ((task.status !== 'CLAIMED' && task.status !== 'RUNNING') || !task.claimToken || !CLAIM_TOKEN.test(task.claimToken)) throw new Error('DEVICE_TASK_CLAIM_REQUIRED');
  if (!task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= Date.now()) throw new Error('DEVICE_TASK_LEASE_EXPIRED');
}
