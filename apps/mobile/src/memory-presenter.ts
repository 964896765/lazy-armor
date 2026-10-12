import type { MemoryReference, MemoryRelationType, MemoryType, PersonalMemory } from '@lazy-armor/plan-schema/mobile';
export const memoryRelationLabels: Record<MemoryRelationType, string> = { OWNS: '拥有', USES: '使用', PREFERS: '偏好', RELATED_TO: '相关' };
export const memoryTypeLabels: Record<MemoryType, string> = { PROFILE: '个人资料', PREFERENCE: '偏好', ASSET: '设备与资产', PERSON: '人物', LOCATION: '常用地点', EVENT: '生活经历', DECISION: '决定', HISTORY: '历史' };
export function memorySourceLabel(memory: PersonalMemory, now = Date.now()) {
  return `${memory.sourceKind === 'REPORT_DECISION_CONFIRMED' ? '针对报告，由你确认的决定' : memory.sourceKind === 'LEARNING_CONFIRMED' ? '来自核验结果，由你确认' : memory.sourceKind === 'CONVERSATION_CONFIRMED' ? '来自会话，由你确认' : '你确认提供'} · ${memory.expiresAt && Date.parse(memory.expiresAt) <= now ? '已过期，不用于理解目标' : '个人信息'}`;
}
export function memoryMutationError(error: unknown) {
  const detail = error as { code?: string; message?: string } | null;
  const marker = detail?.message ?? detail?.code ?? '';
  const messages: Record<string, string> = { MEMORY_VERSION_CHANGED: '这条信息已更新，请重新读取后编辑。',
    MEMORY_USAGE_DISABLED: '个人记忆已关闭，请先在个人记忆页开启。', MEMORY_REQUEST_IDENTITY_CHANGED: '这次保存请求已处理，请返回列表核对后再编辑。',
    MEMORY_EXPIRY_MUST_BE_FUTURE: '新设置的有效期需要晚于现在。', MEMORY_EXPLICIT_CONFIRMATION_REQUIRED: '需要确认后才能保存。',
    MEMORY_CANDIDATE_UNAVAILABLE: '这条建议已失效，请返回会话查看。', MEMORY_CANDIDATE_SOURCE_CHANGED: '来源已变化，请重新核对。',
    MEMORY_CANDIDATE_CONFIRMATION_CHANGED: '这条建议已经确认，请在个人记忆中编辑。',
    LEARNING_CANDIDATE_UNAVAILABLE: '这条经验建议已失效，请返回经验与反馈页。', LEARNING_SOURCE_CHANGED: '核验来源或授权已变化，请重新读取。',
    LEARNING_CONFIRMATION_CHANGED: '这条经验已保存，请在个人记忆中编辑。',
    REPORT_DECISION_INPUT_INVALID: '请填写决定并亲自确认保存。', REPORT_DECISION_SOURCE_CHANGED: '报告已更新，请重新查看当前版本后保存决定。',
    MEMORY_SOURCE_UNAVAILABLE: '信息的来源已失效，请重新核对后再关联。',
    MEMORY_RELATION_ALREADY_RECORDED: '这两条信息已经有关联。', MEMORY_RELATION_VERSION_CHANGED: '关联已变化，请重新读取。',
    MEMORY_RELATION_REQUEST_CHANGED: '这次关联请求已处理，请重新选择后确认。' };
  return messages[marker] ?? '未能保存更改，请稍后重试。';
}
export function memoryReferenceLabel(state: MemoryReference['state']) {
  return ({ CURRENT: '当前信息', CHANGED: '信息已更正，本次展示的是最新版本', DELETED: '信息已删除，后续目标不再使用',
    EXPIRED: '信息已过期，后续目标不再使用', DISABLED: '个人记忆已关闭，后续目标不再使用', SOURCE_UNAVAILABLE: '来源或授权已变化，后续目标不再使用这条经验' })[state];
}
