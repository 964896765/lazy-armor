import type { MemoryType, PersonalMemory } from '@lazy-armor/plan-schema/mobile';
export const memoryTypeLabels: Record<MemoryType, string> = { PROFILE: '个人资料', PREFERENCE: '偏好', ASSET: '设备与资产', PERSON: '人物', LOCATION: '常用地点', EVENT: '生活经历', DECISION: '决定', HISTORY: '历史' };
export function memorySourceLabel(memory: PersonalMemory, now = Date.now()) {
  return `你确认提供 · ${memory.expiresAt && Date.parse(memory.expiresAt) <= now ? '已过期，不用于理解目标' : '个人信息'}`;
}
export function memoryMutationError(error: unknown) {
  const detail = error as { code?: string; message?: string } | null;
  const marker = detail?.message ?? detail?.code ?? '';
  const messages: Record<string, string> = { MEMORY_VERSION_CHANGED: '这条信息已更新，请重新读取后编辑。',
    MEMORY_USAGE_DISABLED: '个人记忆已关闭，请先在个人记忆页开启。', MEMORY_REQUEST_IDENTITY_CHANGED: '这次保存请求已处理，请返回列表核对后再编辑。',
    MEMORY_EXPIRY_MUST_BE_FUTURE: '新设置的有效期需要晚于现在。', MEMORY_EXPLICIT_CONFIRMATION_REQUIRED: '需要确认后才能保存。' };
  return messages[marker] ?? '未能保存更改，请稍后重试。';
}
