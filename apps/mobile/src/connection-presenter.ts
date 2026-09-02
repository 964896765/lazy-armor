export type ProviderReadiness = 'PRODUCTION_READY' | 'BETA' | 'DRAFT_ONLY' | 'DISABLED';

export function connectionStatusLabel(status: string) {
  switch (status) {
    case 'pending_authorization': return '正在连接';
    case 'connected': return '已连接';
    case 'degraded': return '连接异常';
    case 'expired': return '需要重新连接';
    case 'permission_required': return '需要补充权限';
    case 'reauthorization_required': return '需要重新登录';
    case 'provider_error': return '服务暂时异常';
    case 'revoked': return '已断开';
    default: return '暂时无法确认状态';
  }
}

export function connectionRecoveryAction(status: string): string | null {
  switch (status) {
    case 'reauthorization_required':
    case 'expired': return '重新连接';
    case 'permission_required': return '检查权限';
    case 'provider_error': return '重新检查';
    case 'degraded': return '连接有点问题';
    default: return null;
  }
}

export function connectionStatusExplanation(status: string) {
  switch (status) {
    case 'pending_authorization': return '正在等待你完成授权，完成后计划就能继续读取所需数据。';
    case 'connected': return '连接状态正常，计划可以继续读取当前授权范围内的数据。';
    case 'degraded': return '连接状态不稳定，下一次自动运行可能拿不到完整结果。';
    case 'expired': return '连接已经过期，计划暂时拿不到最新数据。';
    case 'permission_required': return '这条连接缺少当前计划需要的授权范围。';
    case 'reauthorization_required': return '账号登录状态已经失效，需要你重新连接。';
    case 'provider_error': return '服务方暂时不可用，这次没能稳定拿到结果。';
    case 'revoked': return '你已经断开这个连接，相关计划会保留，但不会继续读取。';
    default: return '当前连接状态还不能自动判断，请稍后再检查。';
  }
}

export function connectionStatusNextStep(status: string) {
  switch (status) {
    case 'expired':
    case 'reauthorization_required':
      return '重新连接后，计划会自动继续运行。';
    case 'permission_required':
      return '补齐需要的授权后，相关计划就能恢复。';
    case 'provider_error':
      return '稍后重新检查；如果连续失败，再重新连接一次。';
    case 'degraded':
      return '先重新检查一次连接状态，必要时再重新连接。';
    case 'revoked':
      return '如果还想继续使用这项服务，重新连接即可。';
    default:
      return '保持当前状态即可。';
  }
}

export function providerReadinessLabel(status: string) {
  switch (status) {
    case 'PRODUCTION_READY': return '可使用';
    case 'BETA': return '可试用';
    case 'DRAFT_ONLY': return '开发中';
    case 'DISABLED': return '暂不可用';
    default: return '暂不可用';
  }
}

export function capabilityLabel(providerKey: string, capability: string, fallbackName?: string) {
  const contextual = PROVIDER_CAPABILITY_COPY[providerKey]?.[capability];
  if (contextual?.label) return contextual.label;
  switch (capability) {
    case 'READ_EMAIL_METADATA': return '读取邮件标题和时间';
    case 'READ_EMAIL': return '读取邮件内容';
    case 'SEND_EMAIL': return '发送邮件';
    case 'READ_EVENT': return '读取日历事件';
    case 'CREATE_EVENT': return '创建日历事件';
    case 'UPDATE_EVENT': return '修改日历事件';
    case 'READ_FILE_METADATA': return '读取文件信息';
    case 'READ_FILE': return '读取文件内容';
    case 'ARCHIVE_FILE': return '归档文件';
    case 'STORE_FILE': return '保存文件';
    case 'READ_CONTENT': return '读取内容';
    case 'READ_ANALYTICS': return '读取内容表现';
    case 'PUBLISH_CONTENT': return '发布内容';
    case 'READ_TRACKING': return '读取物流状态';
    case 'RECEIVE_WEBHOOK': return '接收外部回调';
    case 'MANUAL_INPUT': return '读取你手动提供的信息';
    case 'READ_INTERNAL': return '读取计划内部信息';
    case 'WRITE_INTERNAL': return '更新系统内部记录';
    default: return fallbackName?.trim() || '其他权限';
  }
}

export function capabilityDescription(providerKey: string, capability: string) {
  const contextual = PROVIDER_CAPABILITY_COPY[providerKey]?.[capability];
  if (contextual?.description) return contextual.description;
  switch (capability) {
    case 'READ_EMAIL_METADATA': return '读取邮件标题、发件人和时间，用于你启用的计划。';
    case 'READ_EMAIL': return '读取邮件内容，用于摘要、提醒和分类。';
    case 'SEND_EMAIL': return '代表你发送邮件，执行前会先让你确认。';
    case 'READ_EVENT': return '读取日程，用于提醒、摘要和冲突判断。';
    case 'CREATE_EVENT': return '替你创建日历事件。';
    case 'UPDATE_EVENT': return '修改已有日历事件。';
    case 'READ_FILE_METADATA': return '读取文件名称、时间和基础信息。';
    case 'READ_FILE': return '读取所选文件内容，用于解析和整理。';
    case 'ARCHIVE_FILE': return '替你归档文件。';
    case 'STORE_FILE': return '保存处理后的文件。';
    case 'READ_CONTENT': return '读取已有内容或草稿。';
    case 'READ_ANALYTICS': return '读取内容的浏览、互动等表现数据。';
    case 'PUBLISH_CONTENT': return '发布内容到外部平台，执行前会先让你确认。';
    case 'READ_TRACKING': return '读取物流状态和最近进展。';
    case 'RECEIVE_WEBHOOK': return '接收对方平台推送的状态更新。';
    case 'MANUAL_INPUT': return '读取你在应用里手动填写的信息。';
    case 'READ_INTERNAL': return '读取计划运行所需的应用内部信息。';
    case 'WRITE_INTERNAL': return '更新应用内部记录，用于状态同步与结果沉淀。';
    default: return '在你授权的范围内完成对应计划动作。';
  }
}

export function consumerErrorMessage(detail: string | null | undefined) {
  if (!detail) return '这次处理暂时没有返回更多说明。';
  const normalized = detail.trim().toLowerCase();
  if (normalized.includes('permission_revoked') || normalized.includes('permission revoked')) {
    return '相关授权已经被撤销，计划暂时不能继续读取或执行。';
  }
  if (normalized.includes('outcome_unknown')) {
    return '这次结果暂时无法自动确认，需要你看一下是否已经处理成功。';
  }
  if (
    normalized.includes('oauth token refresh failed')
    || normalized.includes('refresh token is invalid')
    || normalized.includes('credentials revoked')
    || normalized.includes('refresh_required')
  ) {
    return '账号登录状态已经失效，需要重新连接后才能继续运行。';
  }
  if (normalized.includes('timeout')) {
    return '服务响应超时，这次暂时没有拿到结果。';
  }
  if (
    normalized.includes('provider unavailable')
    || normalized.includes('provider temporary failure')
    || normalized.includes('temporary failure')
    || normalized.includes('provider 5')
  ) {
    return '服务暂时不可用，稍后可以再试一次。';
  }
  if (normalized.includes('rate limit') || normalized.includes('rate limited')) {
    return '服务方临时限制了访问频率，稍后再试即可。';
  }
  if (normalized.includes('plan failed')) {
    return '这次计划没有按预期完成。';
  }
  if (normalized.includes('network')) {
    return '网络暂时不可用，这次没能完成同步。';
  }
  if (normalized.includes('configuration incomplete') || normalized.includes('invalid template config')) {
    return '这条计划还没配置完整，补齐后就能继续运行。';
  }
  if (normalized.includes('missing connection') || normalized.includes('connection is not available')) {
    return '这条计划缺少可用连接，补上后就能继续运行。';
  }
  return detail;
}

export function consumerErrorNextStep(detail: string | null | undefined) {
  if (!detail) return '先重新试一次；如果还是失败，再检查连接和权限。';
  const normalized = detail.trim().toLowerCase();
  if (normalized.includes('permission_revoked') || normalized.includes('permission revoked')) {
    return '去“我的连接”重新授权后，这条计划会继续工作。';
  }
  if (normalized.includes('outcome_unknown')) {
    return '打开记录确认实际结果；如未成功，再重新执行一次。';
  }
  if (
    normalized.includes('oauth token refresh failed')
    || normalized.includes('refresh token is invalid')
    || normalized.includes('credentials revoked')
    || normalized.includes('refresh_required')
    || normalized.includes('missing connection')
  ) {
    return '重新连接对应账号后，再回来启用或重试。';
  }
  if (normalized.includes('timeout') || normalized.includes('provider unavailable') || normalized.includes('temporary failure')) {
    return '稍后重新检查；如果连续失败，再重新连接一次。';
  }
  if (normalized.includes('rate limit') || normalized.includes('rate limited')) {
    return '先等一会儿再试，不需要重复点很多次。';
  }
  if (normalized.includes('network')) {
    return '先确认网络恢复，再重新加载或手动执行。';
  }
  if (normalized.includes('configuration incomplete') || normalized.includes('invalid template config')) {
    return '回到计划详情补齐设置，再重新启用。';
  }
  return '先看连接、权限和当前配置是否齐全，再决定是否重试。';
}

const PROVIDER_CAPABILITY_COPY: Record<string, Record<string, { label: string; description: string }>> = {
  gmail: {
    CREATE_DRAFT: { label: '准备邮件草稿', description: '替你准备邮件草稿，不会直接发送。' },
  },
  content_provider: {
    CREATE_DRAFT: { label: '准备内容草稿', description: '替你准备适合内容平台的草稿，不会直接发布。' },
  },
};

export function capabilityRiskHint(capability: string, riskLevel: string) {
  if (capability === 'PUBLISH_CONTENT' || capability === 'SEND_EMAIL') return '执行前会先让你确认。';
  if (riskLevel === 'R4') return '涉及资金或账户级动作，执行前会加强确认。';
  if (riskLevel === 'R3') return '执行前会先让你确认。';
  if (riskLevel === 'R2') return '主要用于替你准备好内容或结果。';
  if (riskLevel === 'R1') return '主要用于整理信息和生成提醒。';
  return '主要用于读取信息，不会直接对外执行动作。';
}

export function connectionActionLabel(granted: boolean) {
  return granted ? '撤销' : '授权';
}

export function isConsumerConnector(providerKey: string) {
  return !['internal', 'manual', 'webhook'].includes(providerKey);
}
