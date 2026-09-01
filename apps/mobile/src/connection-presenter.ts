export function connectionStatusLabel(status: string) {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'degraded':
      return '连接异常';
    case 'expired':
      return '需要重新连接';
    case 'revoked':
      return '已断开';
    case 'error':
      return '暂时不可用';
    default:
      return '暂不可用';
  }
}

export function capabilityLabel(capability: string, fallbackName?: string) {
  switch (capability) {
    case 'READ_EMAIL_METADATA':
      return '读取邮件概览';
    case 'READ_EMAIL':
      return '读取邮件';
    case 'CREATE_DRAFT':
      return '准备草稿';
    case 'SEND_EMAIL':
      return '发送邮件';
    case 'READ_EVENT':
      return '读取日程';
    case 'CREATE_EVENT':
      return '创建日程';
    case 'UPDATE_EVENT':
      return '修改日程';
    case 'READ_FILE_METADATA':
      return '读取文件信息';
    case 'READ_FILE':
      return '读取文件';
    case 'ARCHIVE_FILE':
      return '归档文件';
    case 'STORE_FILE':
      return '保存文件';
    case 'READ_CONTENT':
      return '读取内容';
    case 'PUBLISH_CONTENT':
      return '发布内容';
    case 'READ_LOGISTICS':
      return '读取物流状态';
    case 'RECEIVE_WEBHOOK':
      return '接收外部回调';
    case 'MANUAL_INPUT':
      return '读取你手动提供的信息';
    case 'WRITE_INTERNAL':
      return '更新系统内部记录';
    default:
      return fallbackName?.trim() || '其他权限';
  }
}

export function capabilityDescription(capability: string) {
  switch (capability) {
    case 'READ_EMAIL_METADATA':
      return '允许懒人装甲读取邮件标题、发件人和时间，用于你启用的计划。';
    case 'READ_EMAIL':
      return '允许懒人装甲读取邮件内容，用于摘要、提醒和后续分类。';
    case 'CREATE_DRAFT':
      return '允许懒人装甲替你准备草稿，真正发送前仍由你决定。';
    case 'SEND_EMAIL':
      return '允许懒人装甲代表你发送邮件。';
    case 'READ_EVENT':
      return '允许懒人装甲读取日程，用于提醒、摘要和冲突判断。';
    case 'CREATE_EVENT':
      return '允许懒人装甲替你创建日程。';
    case 'UPDATE_EVENT':
      return '允许懒人装甲修改现有日程。';
    case 'READ_FILE_METADATA':
      return '允许懒人装甲读取文件名称、时间和基础信息。';
    case 'READ_FILE':
      return '允许懒人装甲读取文件内容，用于解析和整理。';
    case 'ARCHIVE_FILE':
      return '允许懒人装甲替你归档文件。';
    case 'STORE_FILE':
      return '允许懒人装甲保存处理后的文件。';
    case 'READ_CONTENT':
      return '允许懒人装甲读取已存在的内容草稿。';
    case 'PUBLISH_CONTENT':
      return '允许懒人装甲发布内容到外部平台。';
    case 'READ_LOGISTICS':
      return '允许懒人装甲读取物流状态和最近进展。';
    case 'RECEIVE_WEBHOOK':
      return '允许懒人装甲接收对方平台推送的状态更新。';
    case 'MANUAL_INPUT':
      return '允许计划读取你在应用里手动填写的信息。';
    case 'WRITE_INTERNAL':
      return '允许计划更新应用内部记录，用于状态同步与结果沉淀。';
    default:
      return '允许懒人装甲在你授权的范围内完成对应计划动作。';
  }
}

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
