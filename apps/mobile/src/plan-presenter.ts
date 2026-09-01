export type PlanListStatus = '运行中' | '需要设置' | '已暂停';

export function planGroup(status: string): PlanListStatus {
  if (status === 'active' || status === 'ready') return '运行中';
  if (status === 'paused' || status === 'archived') return '已暂停';
  return '需要设置';
}

export function planStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return '需要设置';
    case 'ready':
      return '已准备';
    case 'active':
      return '运行中';
    case 'paused':
      return '已暂停';
    case 'degraded':
      return '降级运行';
    case 'blocked':
      return '已阻断';
    case 'archived':
      return '已归档';
    default:
      return '暂不可用';
  }
}

export function automationLevelLabel(level: string): string {
  switch (level) {
    case 'L0':
      return '只记录';
    case 'L1':
      return '提醒我';
    case 'L2':
      return '替我准备好';
    case 'L3':
      return '执行前会先问你';
    default:
      return '按计划自动处理';
  }
}

export function templateGroupLabel(group: string): string {
  switch (group) {
    case '我的钱':
    case '我的生活':
    case '我的事情':
    case '我的东西':
      return group;
    default:
      return '其他计划';
  }
}

export function sourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case 'manual':
      return '你手动提供的信息';
    case 'internal':
      return '系统里的已有信息';
    case 'billing':
      return '账单连接';
    case 'email':
      return '邮件';
    case 'calendar':
      return '日历';
    case 'webhook':
      return 'Webhook';
    case 'file':
      return '文件';
    case 'content_platform':
      return '内容平台';
    default:
      return '其他来源';
  }
}

export function sourceSummaryLabel(sourceType: string): string {
  switch (sourceType) {
    case 'internal_task':
      return '系统任务';
    case 'manual_event':
      return '手动记录';
    case 'test_email':
    case 'email':
      return '邮件';
    case 'test_calendar':
    case 'calendar':
      return '日历';
    case 'billing':
      return '账单';
    case 'logistics':
      return '快递';
    case 'device':
      return '设备信息';
    default:
      return sourceTypeLabel(sourceType);
  }
}

export function platformLabel(platform: string): string {
  switch (platform) {
    case 'douyin':
      return '抖音';
    case 'bilibili':
      return 'B站';
    case 'xiaohongshu':
      return '小红书';
    case 'kuaishou':
      return '快手';
    case 'wechat_video':
      return '视频号';
    default:
      return '其他平台';
  }
}

export function planCenterStatusLabel(kind: string, status: string): string {
  if (!status) return '暂不可用';
  if (kind === 'content') {
    switch (status) {
      case 'draft_ready':
        return '草稿已准备好';
      case 'needs_revision':
        return '还需要你调整';
      case 'prepared':
        return '发布前已准备好';
      default:
        return '已准备当前内容';
    }
  }
  if (kind === 'daily_summary') {
    switch (status) {
      case 'silent':
        return '本轮无需提醒';
      case 'summary_ready':
        return '摘要已准备好';
      default:
        return '已按当前策略整理';
    }
  }
  if (kind === 'logistics') {
    switch (status) {
      case 'quiet':
        return '目前一切正常';
      case 'stale':
      case 'exception':
        return '需要留意';
      default:
        return '已完成本轮检查';
    }
  }
  if (kind === 'household') {
    switch (status) {
      case 'sufficient':
        return '暂时够用';
      case 'low_stock':
        return '该准备补货了';
      default:
        return '已完成本轮检查';
    }
  }
  return '已按当前计划处理';
}

export function triggerSummary(triggerType: string, config: Record<string, unknown> | null | undefined): string {
  if (triggerType === 'schedule' && typeof config?.cronExpression === 'string') {
    const cron = config.cronExpression;
    const [minute, hour, day, month, weekDay] = cron.split(/\s+/);
    if (day !== '*' && month === '*' && weekDay === '*') return `每月 ${day} 日 ${hour}:${minute}`;
    if (day === '*' && month === '*' && weekDay === '*' && /^\*\/\d+$/.test(hour ?? '')) return `每 ${hour.slice(2)} 小时整`;
    if (day === '*' && month === '*' && weekDay === '*') return `每天 ${hour}:${minute}`;
    if (day === '*' && month === '*' && /^[0-6]$/.test(weekDay ?? '')) return `每周 ${weekdayLabel(Number(weekDay))} ${hour}:${minute}`;
    return '按固定时间运行';
  }
  if (triggerType === 'manual') return '手动触发';
  return '按已配置方式触发';
}

export function conditionSummary(fieldPath: string, operator: string, comparisonValue: unknown): string {
  const fieldLabel = conditionFieldLabel(fieldPath);
  if (fieldLabel === null) return '满足已配置的运行条件时执行';
  const operatorLabel = conditionOperatorLabel(operator);
  const right = typeof comparisonValue === 'object' ? JSON.stringify(comparisonValue) : String(comparisonValue ?? '—');
  return `${fieldLabel} ${operatorLabel} ${right}`;
}

export function actionSummary(actionType: string, config: Record<string, unknown> | null | undefined): string {
  if (actionType === 'notify') {
    return '按你的偏好提醒你';
  }
  if (actionType === 'summarize') return '生成摘要';
  if (actionType === 'compare') return '做周期对比';
  if (actionType === 'classify') return '做分类整理';
  if (actionType === 'generate_content') return '生成平台版本草稿';
  if (actionType === 'create_draft') return '保存平台草稿';
  if (actionType === 'prepare_publish') return '准备发布版本';
  if (actionType === 'prepare_purchase') return '准备补货清单';
  if (actionType === 'create_task') return '生成今天要做的任务';
  return '执行已配置的动作';
}

export function notificationPreferenceLabel(value: unknown): string {
  switch (value) {
    case 'silent':
      return '静默';
    case 'summary':
      return '摘要提醒';
    case 'important':
      return '重要提醒';
    default:
      return '按计划提醒';
  }
}

export function boolLabel(value: unknown): string {
  return value ? '是' : '否';
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '暂未计算';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂未计算';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function weekdayLabel(weekday: number) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday] ?? '未知';
}

function conditionOperatorLabel(operator: string) {
  switch (operator) {
    case 'GT':
      return '大于';
    case 'GTE':
      return '大于等于';
    case 'LT':
      return '小于';
    case 'LTE':
      return '小于等于';
    case 'EQ':
      return '等于';
    case 'PERCENT_CHANGE_GT':
      return '涨幅超过';
    default:
      return '满足条件';
  }
}

function conditionFieldLabel(fieldPath: string) {
  switch (fieldPath) {
    case 'amount.total':
      return '总金额';
    case 'monthOverMonthChangePercent':
      return '与上期相比的变化';
    case 'tracking.hoursSinceUpdate':
      return '快递最近无更新时长';
    case 'household.daysUntilRunOut':
      return '用品预计剩余时间';
    case 'device.remainingDays':
      return '耗材预计剩余时间';
    default:
      return null;
  }
}
