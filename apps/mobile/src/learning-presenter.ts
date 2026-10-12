import type { LearningCandidate } from '@lazy-armor/plan-schema/mobile';
export function learningStatusLabel(status: LearningCandidate['status']) {
  return { PENDING: '待你核对', CONFIRMED: '已保存为历史经验', DISMISSED: '已忽略', UNAVAILABLE: '来源或授权已变化', EXPIRED: '已过期' }[status];
}
export function learningOutcomeLabel(outcome: string | undefined) {
  return outcome === 'SUCCEEDED' ? '已核验成功' : outcome === 'FAILED' ? '已核验失败' : outcome === 'PARTIALLY_SUCCEEDED' ? '已核验部分成功' : '尚无可用核验结果';
}
