/**
 * Android / Provider 真实验收台账（Acceptance Ledger）。
 *
 * 只记录「真实设备 / 真实 Provider 账号」才能取得的证据；在设备或真实账号
 * 连接前，所有条目一律保持 EXTERNAL_ACCEPTANCE_PENDING，绝不把本地 MySQL /
 * 本地 TCP / fixture 模型的结果冒充真机或真实 Provider 验收。
 *
 * 本文件是版本化、可断言的证据台账（非运行时状态机）：每完成一项真实验收，
 * 在对应条目的 state 填 PASSED 并补 evidenceRef（提交 SHA / 环境 / 时间 /
 * 命令 / 输入 / 结果 / artifact/log），再提交。
 */
export const ACCEPTANCE_STATES = ['EXTERNAL_ACCEPTANCE_PENDING', 'PASSED', 'FAILED'] as const;
export type AcceptanceState = (typeof ACCEPTANCE_STATES)[number];

export type AcceptanceCategory = 'ANDROID' | 'PROVIDER';

export interface AcceptanceItem {
  /** 稳定 id，用于台账去重与证据引用。 */
  id: string;
  category: AcceptanceCategory;
  /** 需要证明的能力（人话，不写工程术语）。 */
  capability: string;
  /** 取得证据必须做的事项。 */
  evidenceRequired: string;
  state: AcceptanceState;
  /** 通过后的证据引用（提交 SHA / 日志 / 截图 / 环境）。 */
  evidenceRef: string | null;
}

export const ANDROID_ACCEPTANCE_ITEMS: readonly AcceptanceItem[] = Object.freeze([
  { id: 'android.device.register', category: 'ANDROID', capability: '设备注册（Trusted Device 签名）', evidenceRequired: '真机安装 → 登录 → 注册 → 签名 heartbeat', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.session.heartbeat', category: 'ANDROID', capability: '会话心跳（heartbeat）', evidenceRequired: '在线/离线/过期/撤权状态可复现', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.notification.auth', category: 'ANDROID', capability: '通知监听授权', evidenceRequired: '系统授权 → 真实通知 → receipt/Observation', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.notification.capture', category: 'ANDROID', capability: '真实通知采集', evidenceRequired: '未授权时 fail closed；原始敏感内容按策略保存/删除', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.share.import', category: 'ANDROID', capability: 'Share / 文件导入', evidenceRequired: '真实 Share/文件导入进入证据管线', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.offline', category: 'ANDROID', capability: '断网恢复', evidenceRequired: '断网不产生重复副作用或假 Truth', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.duplicate', category: 'ANDROID', capability: '重复事件幂等', evidenceRequired: 'duplicate event 不重复副作用', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'android.revoke', category: 'ANDROID', capability: '权限撤销', evidenceRequired: 'permission revoked 后停止采集、状态准确', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
]);

export const PROVIDER_ACCEPTANCE_ITEMS: readonly AcceptanceItem[] = Object.freeze([
  { id: 'provider.github', category: 'PROVIDER', capability: 'GitHub 真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.gmail', category: 'PROVIDER', capability: 'Gmail 真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.calendar', category: 'PROVIDER', capability: 'Google Calendar 真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.notion', category: 'PROVIDER', capability: 'Notion 真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.dingtalk', category: 'PROVIDER', capability: '钉钉真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.feishu', category: 'PROVIDER', capability: '飞书真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
  { id: 'provider.wecom', category: 'PROVIDER', capability: '企业微信真实账号', evidenceRequired: '真实 OAuth/scope/quota/health/read-back/终态', state: 'EXTERNAL_ACCEPTANCE_PENDING', evidenceRef: null },
]);

export const ALL_ACCEPTANCE_ITEMS: readonly AcceptanceItem[] = Object.freeze([
  ...ANDROID_ACCEPTANCE_ITEMS,
  ...PROVIDER_ACCEPTANCE_ITEMS,
]);

/** 尚未通过真实验收的条目数（首页/发布门禁可用）。 */
export function pendingAcceptanceCount(): number {
  return ALL_ACCEPTANCE_ITEMS.filter((item) => item.state === 'EXTERNAL_ACCEPTANCE_PENDING').length;
}

/** 是否所有条目都已通过真实验收。 */
export function acceptanceComplete(): boolean {
  return ALL_ACCEPTANCE_ITEMS.every((item) => item.state === 'PASSED');
}
