import {
  CONSUMER_PROJECTION_VERSION,
  type ConsumerReadinessProjection,
  type ConsumerReadinessState,
  type ScenarioReadiness,
} from '@lazy-armor/plan-schema';
import type { CapabilityReadinessEvidence } from './readiness-evidence.service';
export type { ConsumerReadinessProjection } from '@lazy-armor/plan-schema';

interface Input {
  readiness: ScenarioReadiness;
  capabilities: CapabilityReadinessEvidence[];
  platformSupported: boolean;
  deviceRequired: boolean;
  deviceOnline: boolean;
}

export function projectConsumerReadiness(input: Input): ConsumerReadinessProjection {
  const productReadiness = input.platformSupported ? 'IMPLEMENTED' : 'NOT_VERIFIED';
  const required = new Set(input.readiness.missingCapabilities);
  const grants = input.capabilities.filter((item) => required.has(item.capabilityKey));
  let userReadiness: ConsumerReadinessState;
  if (!input.platformSupported || input.readiness.state === 'DISABLED') userReadiness = 'SERVICE_UNAVAILABLE';
  else if ((input.deviceRequired && !input.deviceOnline) || grants.some((item) => item.health === 'DEVICE_OFFLINE')) userReadiness = 'DEVICE_OFFLINE';
  else if (grants.some((item) => item.grant !== 'GRANTED' || item.health === 'REAUTHORIZATION_REQUIRED' || item.health === 'PERMISSION_REVOKED')) userReadiness = 'NEEDS_PERMISSION';
  else if (grants.some((item) => item.health !== 'HEALTHY')) userReadiness = 'SERVICE_UNAVAILABLE';
  else if (input.readiness.missingCapabilities.length > 0) userReadiness = 'NEEDS_CONNECTION';
  else if (input.readiness.missingFacts.length > 0 || input.readiness.reasons.includes('OBSERVATION_PIPELINE_UNAVAILABLE')) userReadiness = 'NEEDS_DATA';
  else if (input.readiness.state !== 'AUTOMATED_READY') userReadiness = 'NEEDS_CONFIRMATION';
  else userReadiness = 'READY';

  const copy: Record<ConsumerReadinessState, [string, string, string, ConsumerReadinessProjection['actionPath']]> = {
    READY: ['可以使用', '所需来源、授权和近期事实已就绪。', '查看今天的安排', '/today'],
    NEEDS_CONNECTION: ['等待连接', '还没有可用的数据来源或执行能力。', '前往连接中心', '/connections'],
    NEEDS_PERMISSION: ['等待授权', '连接权限尚未授予、已过期或被撤销。', '查看连接权限', '/connections'],
    NEEDS_DATA: ['等待真实数据', '尚未收到所需的近期可信事实。', '检查数据来源', '/connections'],
    DEVICE_OFFLINE: ['手机离线', '这项能力需要手机在线并保持设备心跳。', '检查手机连接', '/connections'],
    SERVICE_UNAVAILABLE: ['暂不可用', '平台能力尚未核实、实现，或当前服务不健康。', '查看连接状态', '/connections'],
    NEEDS_CONFIRMATION: ['需要你确认', '已有数据，但执行前仍需要确认或更多运行证据。', '查看今天的待办', '/today'],
    RESULT_UNKNOWN: ['结果待确认', '操作可能已发生，系统已停止自动重试。', '查看记录并核对结果', '/records'],
  };
  const [title, reason, nextAction, actionPath] = copy[userReadiness];
  return { contractVersion: CONSUMER_PROJECTION_VERSION, productReadiness, userReadiness, title, reason, nextAction, actionPath };
}
