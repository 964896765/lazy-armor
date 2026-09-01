export type TodayState = 'signed_out' | 'loading' | 'error' | 'empty' | 'ready';

export function todayState(signedIn: boolean, loading: boolean, error: boolean, itemCount: number): TodayState {
  if (!signedIn) return 'signed_out';
  if (loading) return 'loading';
  if (error) return 'error';
  return itemCount === 0 ? 'empty' : 'ready';
}

export function notificationPriorityLabel(priority: string) {
  return ({ P0: '紧急', P1: '重要', P2: '摘要', P3: '静默' } as Record<string, string>)[priority] ?? '提醒';
}

// 审批卡用「人话」而非机器风险码：说明这一步做什么、为什么需要确认、可能产生什么影响。
export function approvalRiskText(risk: string) {
  return ({
    R4: '这是资金或账户级操作，可能产生真实损失，需要你加强确认。',
    R3: '这一步会对外部账号产生可见影响，需要你的确认。',
    R2: '这一步会创建或准备外部动作，需要你的确认。',
    R1: '这一步会整理内部记录，需要你的确认。',
    R0: '这一步仅读取内容，需要你的确认。',
  } as Record<string, string>)[risk] ?? '需要你的确认。';
}

export function approvalStatusLabel(status: string) {
  return ({ pending: '待确认', approved: '已确认', rejected: '已拒绝', expired: '已过期', cancelled: '已取消' } as Record<string, string>)[status] ?? '待处理';
}

export function riskLevelLabel(risk: string | null) {
  if (!risk) return '未评估';
  return { R0: '仅读取', R1: '内部整理', R2: '准备动作', R3: '外部可见', R4: '资金账户级' }[risk] ?? '需要谨慎确认';
}

export function stepApprovalLabel(step: { approvalGateStatus?: string | null; status?: string }) {
  const status = step.approvalGateStatus;
  if (status === 'waiting_approval' || (step.status === 'pending' && status !== 'not_required')) return '等待你的确认';
  if (status === 'approved') return '已确认通过';
  if (status === 'authorized') return '临时授权命中，已放行';
  if (status === 'not_required') return '无需确认';
  if (status === 'rejected') return '已拒绝';
  if (status === 'cancelled') return '确认已取消';
  return '按当前策略处理';
}
