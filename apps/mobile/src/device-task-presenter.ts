import type { DeviceTaskEvidence, DeviceTaskStatus } from './device-task-client';

export interface DeviceTaskStage {
  key: string;
  label: string;
  state: 'done' | 'current' | 'waiting' | 'failed';
  detail: string;
}

export function deviceTaskStatusLabel(status: DeviceTaskStatus): string {
  switch (status) {
    case 'PENDING': return '等待手机领取';
    case 'AWAITING_DEVICE_EVIDENCE': return '等待真机证据';
    case 'CLAIMED': return '手机已领取';
    case 'RUNNING': return '手机正在处理';
    case 'SUCCEEDED': return '已完成并验证';
    case 'FAILED': return '处理失败';
    default: return '状态未识别';
  }
}

export function deviceTaskStages(evidence: DeviceTaskEvidence): DeviceTaskStage[] {
  const task = evidence.task;
  const terminal = task.status === 'SUCCEEDED' || task.status === 'FAILED';
  const failed = task.status === 'FAILED';
  const hasClaim = task.attemptCount > 0 || Boolean(task.claimedAt);
  const hasEvidence = evidence.observations.length > 0 || evidence.readEvidence.length > 0;
  return [
    { key: 'created', label: '任务已创建', state: 'done', detail: `服务器于 ${task.createdAt} 建立任务` },
    { key: 'queued', label: '等待手机', state: hasClaim ? 'done' : 'current', detail: hasClaim ? '手机已经领取任务' : '等待可信设备在线领取' },
    { key: 'claimed', label: '手机处理', state: terminal ? 'done' : hasClaim ? 'current' : 'waiting', detail: hasClaim ? `第 ${task.attemptCount || 1} 次领取` : '尚未开始' },
    { key: 'evidence', label: '结果与证据', state: hasEvidence ? 'done' : failed ? 'failed' : terminal ? 'waiting' : 'waiting', detail: hasEvidence ? '已记录现实来源证据' : '尚未记录可验证证据' },
    { key: 'complete', label: '完成验证', state: failed ? 'failed' : task.status === 'SUCCEEDED' ? 'done' : 'waiting', detail: failed ? (task.errorCode || '任务失败') : task.status === 'SUCCEEDED' ? '结果已进入事实链' : '等待任务完成' },
  ];
}

export function leaseState(leaseExpiresAt: string | null, now = Date.now()): string {
  if (!leaseExpiresAt) return '没有活动租约';
  const expires = Date.parse(leaseExpiresAt);
  if (Number.isNaN(expires)) return '租约时间不可用';
  return expires <= now ? '租约已过期' : '租约有效';
}
