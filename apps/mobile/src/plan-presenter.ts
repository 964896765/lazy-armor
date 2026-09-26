export type PlanListStatus = '运行中' | '需要设置' | '已暂停';
import { canonicalPlanDomain, domainDefinition } from '@lazy-armor/plan-schema/mobile';
import { uiSpaceDefinition, uiSpaceForDomain, type UiSpaceKey } from './ui-space';

export type ConsumerPlanGroup = UiSpaceKey | '其他';

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
      return '需要留意';
    case 'blocked':
      return '暂时停下';
    case 'archived':
      return '已归档';
    default:
      return '暂不可用';
  }
}

export function planVisualIcon(name: string, kind?: string | null): 'cube-outline' | 'home-outline' | 'mail-outline' | 'videocam-outline' | 'school-outline' | 'hardware-chip-outline' | 'wallet-outline' | 'car-outline' | 'shield-checkmark-outline' {
  if (kind === 'logistics' || name.includes('快递') || name.includes('包裹')) return 'cube-outline';
  if (kind === 'household' || name.includes('家庭') || name.includes('补给')) return 'home-outline';
  if (kind === 'daily_summary' || name.includes('邮件') || name.includes('摘要')) return 'mail-outline';
  if (kind === 'content' || name.includes('内容') || name.includes('发布')) return 'videocam-outline';
  if (kind === 'study' || name.includes('学习') || name.includes('考试')) return 'school-outline';
  if (kind === 'device' || name.includes('设备') || name.includes('耗材')) return 'hardware-chip-outline';
  if (name.includes('账单') || name.includes('消费') || name.includes('订阅')) return 'wallet-outline';
  if (name.includes('车辆') || name.includes('保养')) return 'car-outline';
  return 'shield-checkmark-outline';
}

export function planStatusTone(status: string): 'success' | 'warning' | 'muted' {
  if (status === 'active' || status === 'ready') return 'success';
  if (status === 'paused' || status === 'archived') return 'muted';
  return 'warning';
}

export interface ConsumerPlanStatusInput {
  status: string;
  hasMissingConnection?: boolean;
  hasMissingPermission?: boolean;
  hasMissingData?: boolean;
  needsConfirmation?: boolean;
  blocked?: boolean;
}

export function consumerPlanStatusLabel(input: ConsumerPlanStatusInput): string {
  if (input.status === 'paused' || input.status === 'archived') return '暂停';
  if (input.status === 'blocked' || input.blocked) return '异常';
  if (input.status === 'degraded') return '异常';
  if (input.needsConfirmation) return '需要确认';
  if (input.hasMissingPermission) return '等待授权';
  if (input.hasMissingConnection) return '等待连接';
  if (input.hasMissingData) return '等待数据';
  if (input.status === 'draft') return '需要设置';
  return '运行中';
}

export function consumerPlanStatusTone(input: ConsumerPlanStatusInput): 'success' | 'warning' | 'muted' {
  const label = consumerPlanStatusLabel(input);
  if (label === '运行中') return 'success';
  if (label === '暂停' || label === '需要设置') return 'muted';
  return 'warning';
}

export interface PlanNextStepInput {
  status: string;
  hasMissingConnection?: boolean;
  hasMissingPermission?: boolean;
  hasMissingData?: boolean;
  needsConfirmation?: boolean;
  latestExecutionStatus?: string | null;
  outcome?: string | null;
}

/** 由服务端已有字段推导「下一步」说明，不新增权威状态、不凭空生成带权限的按钮。 */
export function planNextStep(input: PlanNextStepInput): string {
  if (input.status === 'archived') return '计划已经结束，需要时可以重新开启。';
  if (input.status === 'paused') return '计划已暂停，需要时可以继续运行。';
  if (input.status === 'draft') return '还差设置，补齐后即可启用。';
  if (input.hasMissingConnection) return '还缺连接或授权，补好后计划就能继续。';
  if (input.hasMissingPermission) return '授权已失效，需要重新授权。';
  if (input.hasMissingData) return '还缺所需数据，补上后计划就能继续。';
  if (input.needsConfirmation || input.latestExecutionStatus === 'waiting_approval') return '等待你确认或审批。';
  if (input.outcome === 'PENDING_CONFIRMATION') return '等待确认这次执行结果。';
  if (input.outcome === 'OUTCOME_UNKNOWN') return '上次结果待核实，可进入只读核对。';
  if (input.latestExecutionStatus === 'running') return '正在执行中。';
  if (input.status === 'blocked') return '计划受阻，需要你查看具体原因。';
  if (input.status === 'degraded') return '数据或来源需要检查。';
  return '持续跟进中，到点会按计划处理。';
}

/** 数据来源可用性说明：只陈述确凿的「缺连接」，不据此反向推断来源健康/在线。 */
export function sourceHealthHint(hasMissingConnection: boolean, missingProviderNames: string[]): string {
  if (hasMissingConnection) {
    const names = missingProviderNames.length > 0 ? missingProviderNames.join('、') : '相关服务';
    return `还缺 ${names} 的连接或授权，补好后才能继续获取数据。`;
  }
  return '来源是否在线、数据是否新鲜，暂无可验证信息。';
}

export interface PlanExceptionInput {
  hasMissingConnection?: boolean;
  latestExecution?: { status: string; resultSummary: string | null } | null;
  planCenterSummary?: { isException?: boolean; latestEventSummary?: string | null } | null;
}

/** Explains why a plan needs attention, in consumer language; null when nothing is wrong. */
export function planExceptionReason(plan: PlanExceptionInput): string | null {
  if (plan.hasMissingConnection) return '还缺少连接或授权，补上后就能继续';
  if (plan.latestExecution?.status === 'failed') return plan.latestExecution.resultSummary ?? '上一次运行没有成功完成';
  if (plan.planCenterSummary?.isException) return plan.planCenterSummary.latestEventSummary ?? '这次检查发现了需要留意的情况';
  return null;
}

export interface PlanEvidenceInput {
  factLabel: string;
  value: string;
  sourceLabel: string;
  observedAt: string;
  realityLabel: string;
  ruleLabel: string;
}

export function planEvidenceLine(evidence: PlanEvidenceInput): string {
  return `检测到：${evidence.factLabel} ${evidence.value} / 来源：${evidence.sourceLabel} / 获取时间：${evidence.observedAt} / 状态：${evidence.realityLabel} / 计划规则：${evidence.ruleLabel}`;
}

export function planNextRunLabel(status: string, nextRunAt: string | null | undefined): string {
  if (status === 'paused' || status === 'archived') return '需要时可以重新开启';
  if (!nextRunAt) return '下一次时间正在安排';
  return `下次 ${formatTime(nextRunAt)}`;
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

// 只做历史格式解析：旧存储分组（我的钱/我的生活/我的事情/我的物品/我的东西）
// 归一化，不承担新版空间猜测。
function normalizeConsumerGroup(group: string | null | undefined): '我的钱' | '我的生活' | '我的事情' | '我的物品' | null {
  switch (group) {
    case '我的钱':
    case '我的生活':
    case '我的事情':
    case '我的物品':
      return group;
    // 历史模板使用“我的东西”；仅兼容归一化为“我的物品”。
    case '我的东西':
      return '我的物品';
    default:
      return null;
  }
}

// 旧分组 → 新空间，仅无歧义映射。旧“我的事情”会拆成 affairs/work，
// 必须依据 domain 决定，故返回 null（不得猜测）。
function legacyGroupToSpace(legacy: '我的钱' | '我的生活' | '我的事情' | '我的物品'): UiSpaceKey | null {
  switch (legacy) {
    case '我的钱':
      return 'property';
    case '我的生活':
      return 'life';
    case '我的物品':
      return 'property';
    case '我的事情':
      return null;
  }
}

export function consumerPlanGroupLabel(group: ConsumerPlanGroup): string {
  return group === '其他' ? '其他计划' : uiSpaceDefinition(group).label;
}

export function templateGroupLabel(group: string): string {
  const legacy = normalizeConsumerGroup(group);
  if (!legacy) return '其他计划';
  const space = legacyGroupToSpace(legacy);
  return space ? consumerPlanGroupLabel(space) : '其他计划';
}

const TEMPLATE_GROUP_BY_KEY: Record<string, '我的钱' | '我的生活' | '我的事情' | '我的物品'> = {
  'monthly-bill-summary': '我的钱',
  'mobile-bill-guard': '我的钱',
  'utility-bill-guard': '我的钱',
  'abnormal-spend-guard': '我的钱',
  'quiet-delivery-guard': '我的生活',
  'family-supply-reminder': '我的生活',
  'recurring-life-reminder': '我的生活',
  'video-multi-platform': '我的事情',
  'daily-important-summary': '我的事情',
  'exam-study-plan': '我的事情',
  'operations-daily-summary': '我的事情',
  'work-follow-up-reminder': '我的事情',
  'calendar-conflict-guard': '我的事情',
  'file-archive-preparation': '我的事情',
  'device-consumable-reminder': '我的物品',
  'vehicle-care-reminder': '我的物品',
  'digital-subscription-reminder': '我的物品',
};

export function consumerPlanGroup(input: { templateKey?: string | null; planCenterKind?: string | null; consumerGroup?: string | null; domain?: string | null }): ConsumerPlanGroup {
  // Primary：canonical domainKey → UiSpaceKey（正确拆分 work → affairs/work）。
  const canonical = canonicalPlanDomain(input.domain);
  if (canonical) {
    const space = uiSpaceForDomain(canonical);
    if (space) return space;
  }
  // Historical compat：旧存储分组 → 新空间（仅无歧义映射）。
  const legacy = normalizeConsumerGroup(input.consumerGroup);
  if (legacy) {
    const space = legacyGroupToSpace(legacy);
    if (space) return space;
  }
  // Template fallback：无 domain 时按模板旧分组映射（无歧义才生效）。
  if (input.templateKey && TEMPLATE_GROUP_BY_KEY[input.templateKey]) {
    const space = legacyGroupToSpace(TEMPLATE_GROUP_BY_KEY[input.templateKey]);
    if (space) return space;
  }
  return '其他';
}

export function planDomainLabel(domain: string | null | undefined): string {
  return domainDefinition(domain)?.label ?? '未分类';
}

export function consumerPlanGroupSubtitle(group: ConsumerPlanGroup): string {
  return group === '其他' ? '其他暂未归类的计划' : uiSpaceDefinition(group).description;
}

/** 计划中心「管理中」筛选：仍由计划引擎照看的计划，不等于正在执行。 */
export function isManagingPlanStatus(status: string): boolean {
  return status === 'active' || status === 'ready' || status === 'degraded' || status === 'blocked';
}

/** 计划中心「失败」判定：计划或最近执行失败/错误，或 Consumer Outcome 为 FAILED。 */
export function isFailedPlanStatus(status: string, latestExecutionStatus?: string | null, outcome?: string | null): boolean {
  return ['failed', 'error'].includes(status) || ['failed', 'error'].includes(latestExecutionStatus ?? '') || outcome === 'FAILED';
}

/** 创建入口场景上下文参数校验：合法格式为 `domain.key`。 */
export function isValidScenarioKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(value);
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
  if (actionType === 'archive') return '准备文件归档清单';
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
