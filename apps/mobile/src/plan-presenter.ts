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
      return status;
  }
}

export function automationLevelLabel(level: string): string {
  switch (level) {
    case 'L0':
      return '只记录';
    case 'L1':
      return '自动整理';
    case 'L2':
      return '自动准备';
    case 'L3':
      return '自动执行';
    default:
      return level;
  }
}

export function sourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case 'manual':
      return '手动输入';
    case 'internal':
      return '内部数据';
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
      return sourceType;
  }
}

export function triggerSummary(triggerType: string, config: Record<string, unknown> | null | undefined): string {
  if (triggerType === 'schedule' && typeof config?.cronExpression === 'string') {
    const cron = config.cronExpression;
    const [minute, hour, day, month, weekDay] = cron.split(/\s+/);
    if (day !== '*' && month === '*' && weekDay === '*') return `每月 ${day} 日 ${hour}:${minute}`;
    if (day === '*' && month === '*' && weekDay === '*' && /^\*\/\d+$/.test(hour ?? '')) return `每 ${hour.slice(2)} 小时整`;
    if (day === '*' && month === '*' && weekDay === '*') return `每天 ${hour}:${minute}`;
    if (day === '*' && month === '*' && /^[0-6]$/.test(weekDay ?? '')) return `每周 ${weekdayLabel(Number(weekDay))} ${hour}:${minute}`;
    return cron;
  }
  if (triggerType === 'manual') return '手动触发';
  return triggerType;
}

export function conditionSummary(fieldPath: string, operator: string, comparisonValue: unknown): string {
  const operatorLabel = conditionOperatorLabel(operator);
  const right = typeof comparisonValue === 'object' ? JSON.stringify(comparisonValue) : String(comparisonValue ?? '—');
  return `${fieldPath} ${operatorLabel} ${right}`;
}

export function actionSummary(actionType: string, config: Record<string, unknown> | null | undefined): string {
  if (actionType === 'notify') {
    return `通知你${typeof config?.priority === 'string' ? `（${config.priority}）` : ''}`;
  }
  if (actionType === 'summarize') return '生成摘要';
  if (actionType === 'compare') return '做周期对比';
  if (actionType === 'classify') return '做分类整理';
  if (actionType === 'generate_content') return '生成平台版本草稿';
  if (actionType === 'create_draft') return '保存平台草稿';
  if (actionType === 'prepare_publish') return '准备发布版本';
  if (actionType === 'prepare_purchase') return '准备补货清单';
  return actionType;
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
      return typeof value === 'string' ? value : '—';
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
      return operator;
  }
}
