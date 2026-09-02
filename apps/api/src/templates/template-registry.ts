import {
  ACTION_DEFINITIONS,
  normalizePlanDefinition,
  type ActionType,
  type ApprovalPolicyDefinition,
  type AutomationLevel,
  type PlanDefinitionInput,
  type RiskLevel,
} from '@lazy-armor/plan-schema';
import { z } from 'zod';

export type TemplateStatus = 'published' | 'draft';
export type TemplateFieldType = 'number' | 'boolean' | 'select' | 'multiselect' | 'text' | 'date' | 'time';

export interface TemplateConfigFieldOption {
  value: string;
  label: string;
}

export interface TemplateConfigField {
  key: string;
  type: TemplateFieldType;
  required: boolean;
  label: string;
  helpText: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  options?: TemplateConfigFieldOption[];
}

export interface TemplateDetailContent {
  doesWhat: string;
  runsWhen: string;
  dataNeeded: string;
  remindsWhen: string;
  connectionSummary: string;
  riskSummary: string;
}

export interface PlanTemplateMetadata {
  templateKey: string;
  templateVersion: string;
  templateConfig: Record<string, unknown>;
}

export interface ResolvedPlanTemplate {
  manifest: PlanTemplateManifest;
  config: Record<string, unknown>;
  definition: PlanDefinitionInput;
  metadata: PlanTemplateMetadata;
}

export interface PlanTemplateManifest {
  key: string;
  templateVersion: string;
  domain: PlanDefinitionInput['domain'];
  group: '我的钱' | '我的生活' | '我的事情' | '我的东西';
  name: string;
  description: string;
  icon: string;
  status: TemplateStatus;
  automationLevel: AutomationLevel;
  requiredConnectors: string[];
  approvalPolicy: ApprovalPolicyDefinition;
  riskConstraint: TemplateRiskConstraint;
  notificationPolicy: TemplateNotificationPolicy;
  details: TemplateDetailContent;
  configFields: TemplateConfigField[];
  configSchema: z.ZodObject<z.ZodRawShape>;
  buildDefinition(config: Record<string, unknown>): PlanDefinitionInput;
}

export type TemplateNotificationMode = 'silent' | 'summary' | 'important';

export interface TemplateNotificationPolicy {
  defaultMode: TemplateNotificationMode;
  allowedModes: TemplateNotificationMode[];
  silentOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyOnNeedsAction: boolean;
}

export interface TemplateRiskConstraint {
  maxRiskLevel: RiskLevel;
  allowExternalSideEffect: boolean;
  allowedActionTypes: ActionType[];
}

function schedule(cronExpression: string) {
  const triggers: PlanDefinitionInput['triggers'] = [
    { triggerType: 'schedule', config: { cronExpression, timezone: 'Asia/Shanghai' }, sortOrder: 0 },
  ];
  return triggers;
}

function scheduleFromTime(value: string) {
  const [hour, minute] = value.split(':');
  return schedule(`${Number(minute)} ${Number(hour)} * * *`);
}

function parseDelimitedTextList(value: string) {
  return value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const manualSource: PlanDefinitionInput['sources'] = [
  { sourceType: 'manual', config: {}, sortOrder: 0 },
];

const internalBillingSource = (billingPeriod: string): PlanDefinitionInput['sources'] => [
  { sourceType: 'internal', config: { resource: 'billing_records', billingPeriod }, sortOrder: 0 },
];

function billingSource(sourceType: string, billingPeriod: string) {
  return sourceType === 'internal' ? internalBillingSource(billingPeriod) : manualSource;
}

function billingNotificationPriority(preference: string): 'P1' | 'P2' {
  return preference === 'important' ? 'P1' : 'P2';
}

function scheduleFromInterval(interval: '6h' | '12h' | '24h') {
  if (interval === '6h') return schedule('0 */6 * * *');
  if (interval === '12h') return schedule('0 */12 * * *');
  return schedule('0 9 * * *');
}

const RISK_SCORE: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };
const NEVER_APPROVAL_POLICY: ApprovalPolicyDefinition = { type: 'never', config: {} };
const R3_APPROVAL_POLICY: ApprovalPolicyDefinition = { type: 'above_risk_level', config: { riskLevel: 'R3' } };

function riskConstraint(maxRiskLevel: RiskLevel, allowedActionTypes: ActionType[], allowExternalSideEffect = false): TemplateRiskConstraint {
  return { maxRiskLevel, allowedActionTypes, allowExternalSideEffect };
}

function notificationPolicy(
  defaultMode: TemplateNotificationMode,
  allowedModes: TemplateNotificationMode[],
  options?: Partial<Pick<TemplateNotificationPolicy, 'silentOnSuccess' | 'notifyOnFailure' | 'notifyOnNeedsAction'>>,
): TemplateNotificationPolicy {
  return {
    defaultMode,
    allowedModes,
    silentOnSuccess: options?.silentOnSuccess ?? defaultMode === 'silent',
    notifyOnFailure: options?.notifyOnFailure ?? true,
    notifyOnNeedsAction: options?.notifyOnNeedsAction ?? true,
  };
}

const monthlyBillSummarySchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  summaryDay: z.number().int().min(1).max(28).default(1),
  sourceType: z.enum(['manual', 'internal']).default('manual'),
  billingPeriod: z.enum(['current_month', 'previous_month']).default('current_month'),
  showCategories: z.boolean().default(true),
  showMonthOverMonth: z.boolean().default(true),
  anomalyThresholdPercent: z.number().min(1).max(500).default(20),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('silent'),
}).strict();

const mobileBillGuardSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  monthlyThreshold: z.number().min(0).max(100000).default(150),
  percentIncreaseThreshold: z.number().min(1).max(500).default(30),
  sourceType: z.enum(['manual', 'internal']).default('manual'),
  onlyAbnormalNotify: z.boolean().default(true),
  checkDayOfMonth: z.number().int().min(1).max(28).default(5),
}).strict();

const quietDeliveryGuardSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  trackingNumber: z.string().trim().min(1).max(120),
  carrier: z.enum(['auto', 'manual', 'sf', 'jd', 'yto', 'yto_express', 'zto', 'sto', 'yunda', 'ems']).default('auto'),
  staleHours: z.number().int().min(1).max(24 * 30).default(48),
  notifyOnException: z.boolean().default(true),
  notifyOnDelivered: z.boolean().default(false),
  checkInterval: z.enum(['6h', '12h', '24h']).default('24h'),
}).strict();

const familySupplyReminderSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  itemName: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  lastPurchasedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '请输入 YYYY-MM-DD 格式的日期'),
  purchaseQuantity: z.number().int().min(1).max(1000000).default(1),
  estimatedUsageDays: z.number().int().min(1).max(3650),
  remindBeforeDays: z.number().int().min(0).max(3650).default(7),
  preparationMode: z.enum(['reminder', 'shopping_list']).default('reminder'),
}).strict();

const videoMultiPlatformSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  masterContentId: z.string().uuid(),
  targetPlatforms: z.array(z.enum(['douyin', 'bilibili'])).min(1).max(2),
  generateTitle: z.boolean().default(true),
  generateDescription: z.boolean().default(true),
  generateTags: z.boolean().default(true),
  prepareCover: z.boolean().default(true),
  requireApprovalBeforePublish: z.boolean().default(true),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const dailyImportantSummarySchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  summaryTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '请输入 HH:mm 格式的时间'),
  includedSources: z.array(z.enum(['internal_task', 'manual_event', 'test_email', 'test_calendar', 'email', 'calendar'])).min(1).max(6),
  emailConnectionId: z.string().uuid().optional(),
  calendarConnectionId: z.string().uuid().optional(),
  lookAheadHours: z.number().int().min(1).max(24 * 7).default(24),
  includeCalendar: z.boolean().default(true),
  includeMessages: z.boolean().default(true),
  maxItems: z.number().int().min(1).max(20).default(5),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const examStudyPlanSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  examName: z.string().trim().min(1).max(120).default('我的考试'),
  examDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '请输入 YYYY-MM-DD 格式的日期').default('2027-01-01'),
  subjects: z.string().trim().min(1).max(500).default('科目一，科目二'),
  dailyStudyMinutes: z.number().int().min(15).max(24 * 60).default(60),
  preferredStudyTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '请输入 HH:mm 格式的时间').default('20:00'),
  target: z.string().trim().min(1).max(255).default('按计划完成备考'),
  currentProgress: z.number().int().min(0).max(100).default(0),
  weeklySummaryDay: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).default('sunday'),
  missedTaskStrategy: z.enum(['catch_up_today', 'rebalance_future']).default('catch_up_today'),
}).strict();

const deviceConsumableReminderSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  deviceProfileId: z.string().uuid(),
  consumableId: z.string().uuid(),
  preparationMode: z.enum(['reminder', 'shopping_list']).default('shopping_list'),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const vehicleCareReminderSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  profileId: z.string().uuid(),
  reminderTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  remindBeforeDays: z.number().int().min(1).max(180).default(30),
  mileageBufferKm: z.number().int().min(0).max(10000).default(500),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const digitalSubscriptionReminderSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  profileId: z.string().uuid(),
  reminderTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  remindBeforeDays: z.number().int().min(1).max(180).default(14),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const utilityBillGuardSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  category: z.enum(['水费', '电费', '燃气', '宽带']),
  monthlyThreshold: z.number().min(0).max(1000000),
  increaseThresholdPercent: z.number().min(1).max(1000).default(30),
  checkDayOfMonth: z.number().int().min(1).max(28).default(5),
}).strict();

const abnormalSpendGuardSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  amountThreshold: z.number().min(0).max(100000000),
  increaseThresholdPercent: z.number().min(1).max(1000).default(50),
  notificationPreference: z.enum(['summary', 'important']).default('important'),
}).strict();

const calendarConflictGuardSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  calendarConnectionId: z.string().uuid(),
  checkTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('07:30'),
}).strict();

const fileArchivePreparationSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  fileConnectionId: z.string().uuid(),
  destination: z.enum(['项目资料', '财务凭证', '行政资料', '参考资料']).default('项目资料'),
}).strict();

const recurringItemReminderSchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  profileId: z.string().uuid(),
  reminderTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

const operationsDailySummarySchema = z.object({
  planName: z.string().trim().min(1).max(120).optional(),
  summaryTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('21:00'),
  notificationPreference: z.enum(['silent', 'summary', 'important']).default('summary'),
}).strict();

export const PLAN_TEMPLATES: readonly PlanTemplateManifest[] = [
  {
    key: 'monthly-bill-summary',
    templateVersion: '1',
    domain: 'billing',
    group: '我的钱',
    name: '月度账单汇总',
    description: '按月整理账单、汇总支出和异常变化，先给你一份能看懂的月报。',
    icon: '账单',
    status: 'published',
    automationLevel: 'L1',
    requiredConnectors: ['manual', 'internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['classify', 'compare', 'summarize', 'notify']),
    notificationPolicy: notificationPolicy('silent', ['silent', 'summary', 'important']),
    details: {
      doesWhat: '自动汇总一个统计周期内的账单金额，整理分类、环比和异常变化。',
      runsWhen: '每月固定日期上午运行一次，也可以手动触发补跑。',
      dataNeeded: '账单金额、分类、账单周期、发生时间，以及上一个周期的对比数据。',
      remindsWhen: '默认静默；如果你选择摘要或重要提醒，会在月报生成后告诉你。',
      connectionSummary: '第一版支持手动输入或内部测试账单源，真实 Billing Connector 留到 P2。',
      riskSummary: '这类计划只做整理与提醒，不会转账、支付，也不需要额外确认。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '给这份月度账单计划起一个你容易认出的名字。' },
      { key: 'summaryDay', type: 'number', required: true, label: '每月汇总日期', helpText: '选择每个月哪一天生成账单月报。', defaultValue: 1, min: 1, max: 28 },
      { key: 'sourceType', type: 'select', required: true, label: '账单来源', helpText: '先支持手动输入和内部测试账单源。', defaultValue: 'manual', options: [{ value: 'manual', label: '手动输入' }, { value: 'internal', label: '内部测试源' }] },
      { key: 'billingPeriod', type: 'select', required: true, label: '统计周期', helpText: '选择统计当前月份还是上一个月。', defaultValue: 'current_month', options: [{ value: 'current_month', label: '本月' }, { value: 'previous_month', label: '上月' }] },
      { key: 'showCategories', type: 'boolean', required: true, label: '显示分类汇总', helpText: '按类别整理支出结构。', defaultValue: true },
      { key: 'showMonthOverMonth', type: 'boolean', required: true, label: '显示环比', helpText: '对比上一个统计周期的总金额。', defaultValue: true },
      { key: 'anomalyThresholdPercent', type: 'number', required: true, label: '异常变化阈值', helpText: '超过这个涨幅时会标记为异常。', defaultValue: 20, min: 1, max: 500 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒方式', helpText: '正常情况下建议保持静默。', defaultValue: 'silent', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: monthlyBillSummarySchema,
    buildDefinition(config) {
      const parsed = monthlyBillSummarySchema.parse(config);
      const actions: PlanDefinitionInput['actions'] = [
        {
          actionType: 'classify',
          config: { taxonomy: 'billing', showCategories: parsed.showCategories, billingPeriod: parsed.billingPeriod },
          stepOrder: 0,
        },
        {
          actionType: 'compare',
          config: { baseline: 'previous_period', enabled: parsed.showMonthOverMonth, anomalyThresholdPercent: parsed.anomalyThresholdPercent },
          stepOrder: 1,
        },
        {
          actionType: 'summarize',
          config: { format: 'detailed', showCategories: parsed.showCategories, showMonthOverMonth: parsed.showMonthOverMonth },
          stepOrder: 2,
        },
      ];
      if (parsed.notificationPreference !== 'silent') {
        actions.push({
          actionType: 'notify',
          config: { channel: 'in_app', priority: billingNotificationPriority(parsed.notificationPreference), eventType: 'billing_monthly_summary_ready' },
          stepOrder: actions.length,
        });
      }
      return {
        name: parsed.planName?.trim() || '月度账单汇总',
        description: '按月汇总账单并输出摘要，不做转账、不做支付。',
        domain: 'billing',
        automationLevel: 'L1',
        sources: billingSource(parsed.sourceType, parsed.billingPeriod),
        triggers: schedule(`0 9 ${parsed.summaryDay} * *`),
        conditions: [],
        actions,
      };
    },
  },
  {
    key: 'mobile-bill-guard',
    templateVersion: '1',
    domain: 'billing',
    group: '我的钱',
    name: '话费异常守护',
    description: '平时安静，只有金额明显偏高时才提醒你。',
    icon: '话费',
    status: 'published',
    automationLevel: 'L1',
    requiredConnectors: ['manual', 'internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['compare', 'summarize', 'notify']),
    notificationPolicy: notificationPolicy('silent', ['silent', 'important']),
    details: {
      doesWhat: '检查本月话费是不是超过你的阈值，或者相比上月突然上涨。',
      runsWhen: '每月固定日期检查一次，也能在接收到新账单后手动复核。',
      dataNeeded: '本月金额、上月金额或可推导的涨幅，以及账单来源。',
      remindsWhen: '只有异常时才提醒，正常月份默认安静。',
      connectionSummary: '第一版支持手动输入和内部测试账单源，不接真实运营商账单。',
      riskSummary: '这类计划只做比对和提醒，不会自动付费，也不触发高风险动作。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“我的话费守护”或“爸妈话费异常提醒”。' },
      { key: 'monthlyThreshold', type: 'number', required: true, label: '月话费阈值', helpText: '超过这个金额就提醒。', defaultValue: 150, min: 0, max: 100000 },
      { key: 'percentIncreaseThreshold', type: 'number', required: true, label: '相比上月上涨百分比', helpText: '涨幅超过这个比例就提醒。', defaultValue: 30, min: 1, max: 500 },
      { key: 'sourceType', type: 'select', required: true, label: '数据来源', helpText: '先支持手动输入和内部测试账单源。', defaultValue: 'manual', options: [{ value: 'manual', label: '手动输入' }, { value: 'internal', label: '内部测试源' }] },
      { key: 'onlyAbnormalNotify', type: 'boolean', required: true, label: '仅异常提醒', helpText: '保持静默，只在超阈值或涨幅异常时提醒。', defaultValue: true },
      { key: 'checkDayOfMonth', type: 'number', required: true, label: '检查日期', helpText: '每个月哪一天自动检查本月话费。', defaultValue: 5, min: 1, max: 28 },
    ],
    configSchema: mobileBillGuardSchema,
    buildDefinition(config) {
      const parsed = mobileBillGuardSchema.parse(config);
      const actions: PlanDefinitionInput['actions'] = [
        { actionType: 'compare', config: { baseline: 'previous_period', enabled: true, anomalyThresholdPercent: parsed.percentIncreaseThreshold }, stepOrder: 0 },
        { actionType: 'summarize', config: { format: 'short', guardType: 'mobile_bill' }, stepOrder: 1 },
      ];
      if (parsed.onlyAbnormalNotify) {
        actions.push({
          actionType: 'notify',
          config: { channel: 'in_app', priority: 'P1', eventType: 'billing_mobile_bill_anomaly' },
          stepOrder: actions.length,
        });
      }
      return {
        name: parsed.planName?.trim() || '话费异常守护',
        description: '当话费超过阈值或相比上月涨幅异常时提醒，正常月份保持静默。',
        domain: 'billing',
        automationLevel: 'L1',
        sources: billingSource(parsed.sourceType, 'current_month'),
        triggers: schedule(`0 10 ${parsed.checkDayOfMonth} * *`),
        conditions: [
          { groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: parsed.monthlyThreshold, sortOrder: 0 },
          { groupId: 'root', logicalOperator: 'OR', fieldPath: 'amountChange', operator: 'PERCENT_CHANGE_GT', comparisonValue: parsed.percentIncreaseThreshold, sortOrder: 1 },
        ],
        actions,
      };
    },
  },
  {
    key: 'quiet-delivery-guard',
    templateVersion: '1',
    domain: 'life',
    group: '我的生活',
    name: '快递静默管家',
    description: '快递正常就不吵你，长时间没动静或异常了再提醒。',
    icon: '快递',
    status: 'published',
    automationLevel: 'L1',
    requiredConnectors: ['manual', 'internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']),
    notificationPolicy: notificationPolicy('important', ['important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '自动帮你盯着快递，正常运输时不打扰，长时间没动静或出现异常时再告诉你。',
      runsWhen: '按你设置的检查频率定时检查一次。',
      dataNeeded: '运单号、承运方、最近物流状态和更新时间。',
      remindsWhen: '超过设定小时数没有进展、已签收或出现异常时按你的偏好提醒。',
      connectionSummary: '第一版支持手工或内部测试物流快照，不依赖真实物流 Provider。',
      riskSummary: '只做状态检查与提醒，不会代你签收，也不会触发外部不可逆操作。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“盯住我的快递”。' },
      { key: 'trackingNumber', type: 'text', required: true, label: '运单号', helpText: '第一版支持人工填写运单号。' },
      { key: 'carrier', type: 'select', required: true, label: '承运方', helpText: '可自动识别，也可以从常见快递里手动选择。', defaultValue: 'auto', options: [{ value: 'auto', label: '自动识别' }, { value: 'sf', label: '顺丰' }, { value: 'jd', label: '京东' }, { value: 'yto', label: '圆通' }, { value: 'zto', label: '中通' }, { value: 'sto', label: '申通' }, { value: 'yunda', label: '韵达' }, { value: 'ems', label: 'EMS' }] },
      { key: 'staleHours', type: 'number', required: true, label: '多久算没动静', helpText: '超过这个小时数没有新进展就提醒。', defaultValue: 48, min: 1, max: 720 },
      { key: 'notifyOnException', type: 'boolean', required: true, label: '异常时提醒', helpText: '运输异常、地址问题或配送失败时提醒。', defaultValue: true },
      { key: 'notifyOnDelivered', type: 'boolean', required: true, label: '签收时提醒', helpText: '默认静默，只有你开启时才提醒已签收。', defaultValue: false },
      { key: 'checkInterval', type: 'select', required: true, label: '检查频率', helpText: '多久检查一次物流状态。', defaultValue: '24h', options: [{ value: '6h', label: '每 6 小时' }, { value: '12h', label: '每 12 小时' }, { value: '24h', label: '每天一次' }] },
    ],
    configSchema: quietDeliveryGuardSchema,
    buildDefinition(config) {
      const parsed = quietDeliveryGuardSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '快递静默管家',
        description: '自动盯住快递，正常静默，异常或长时间没动静时提醒。',
        domain: 'life',
        automationLevel: 'L1',
        sources: [{ sourceType: 'internal', config: { resource: 'logistics_tracking_snapshots', trackingNumber: parsed.trackingNumber, carrier: parsed.carrier, staleHours: parsed.staleHours, notifyOnException: parsed.notifyOnException, notifyOnDelivered: parsed.notifyOnDelivered }, sortOrder: 0 }],
        triggers: scheduleFromInterval(parsed.checkInterval),
        conditions: [],
        actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'logistics', staleHours: parsed.staleHours, notifyOnException: parsed.notifyOnException, notifyOnDelivered: parsed.notifyOnDelivered }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: 'P1', eventType: 'delivery_attention_needed' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'family-supply-reminder',
    templateVersion: '1',
    domain: 'family',
    group: '我的生活',
    name: '家庭补给提醒',
    description: '根据消耗周期提前准备补货清单，先提醒，不自动下单。',
    icon: '补给',
    status: 'published',
    automationLevel: 'L2',
    requiredConnectors: ['manual', 'internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'prepare_purchase', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '根据消耗周期估算快用完的时间，提前准备补货清单。',
      runsWhen: '按计划定时检查，也会跟着你更新最近一次购买时间重新计算。',
      dataNeeded: '用品名称、分类、上次购买时间、购买数量和预计可用天数。',
      remindsWhen: '快用完时提醒你，或者替你准备补货清单，但不会自动下单。',
      connectionSummary: '第一版只使用手工或内部补给资料，不接商城。',
      riskSummary: '先停在准备清单和提醒，不做自动购买。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“家里纸巾提醒”。' },
      { key: 'itemName', type: 'text', required: true, label: '用品名称', helpText: '例如纸巾、饮用水、洗衣液。' },
      { key: 'category', type: 'text', required: true, label: '用品分类', helpText: '例如日用、宠物、滤芯耗材。' },
      { key: 'lastPurchasedAt', type: 'date', required: true, label: '最近购买日期', helpText: '使用日期字符串，例如 2026-09-01。' },
      { key: 'purchaseQuantity', type: 'number', required: true, label: '购买数量', helpText: '这次一共买了多少。', defaultValue: 1, min: 1, max: 1000000 },
      { key: 'estimatedUsageDays', type: 'number', required: true, label: '预计可用天数', helpText: '按确定性数值填写，不使用 AI 作为运行事实。', min: 1, max: 3650 },
      { key: 'remindBeforeDays', type: 'number', required: true, label: '提前几天提醒', helpText: '距离预计用完还有多少天时开始提醒。', defaultValue: 7, min: 0, max: 3650 },
      { key: 'preparationMode', type: 'select', required: true, label: '提醒方式', helpText: '只提醒，或直接准备内部补货清单。', defaultValue: 'reminder', options: [{ value: 'reminder', label: '提醒' }, { value: 'shopping_list', label: '补货清单' }] },
    ],
    configSchema: familySupplyReminderSchema,
    buildDefinition(config) {
      const parsed = familySupplyReminderSchema.parse(config);
      const actions: PlanDefinitionInput['actions'] = [
        { actionType: 'summarize', config: { format: 'short', domain: 'household', preparationMode: parsed.preparationMode }, stepOrder: 0 },
        ...(parsed.preparationMode === 'shopping_list'
          ? [{ actionType: 'prepare_purchase', config: { currency: 'CNY', domain: 'household', itemName: parsed.itemName, preparationMode: parsed.preparationMode }, stepOrder: 1 } as const]
          : []),
        { actionType: 'notify', config: { channel: 'in_app', priority: parsed.preparationMode === 'reminder' ? 'P1' : 'P2', eventType: 'family_supply_prepare' }, stepOrder: parsed.preparationMode === 'shopping_list' ? 2 : 1 },
      ];
      return {
        name: parsed.planName?.trim() || '家庭补给提醒',
        description: '快用完时准备补货清单，不自动购买。',
        domain: 'family',
        automationLevel: 'L2',
        sources: [{
          sourceType: 'internal',
          config: {
            resource: 'household_supply_profile',
            itemName: parsed.itemName,
            category: parsed.category,
            lastPurchasedAt: parsed.lastPurchasedAt,
            purchaseQuantity: parsed.purchaseQuantity,
            estimatedUsageDays: parsed.estimatedUsageDays,
            remindBeforeDays: parsed.remindBeforeDays,
            preparationMode: parsed.preparationMode,
          },
          sortOrder: 0,
        }],
        triggers: schedule('0 9 * * *'),
        conditions: [],
        actions,
      };
    },
  },
  {
    key: 'video-multi-platform',
    templateVersion: '1',
    domain: 'content',
    group: '我的事情',
    name: '视频一稿多发',
    description: '先生成平台适配草稿和准备信息，没有稳定发布能力的平台只停在准备态。',
    icon: '视频',
    status: 'published',
    automationLevel: 'L2',
    requiredConnectors: ['internal'],
    approvalPolicy: R3_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R2', ['generate_content', 'create_draft', 'prepare_publish', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important']),
    details: {
      doesWhat: '上传一次内容，帮你整理成不同平台需要的版本。',
      runsWhen: '手动触发后，先生成平台草稿，再停在准备态。',
      dataNeeded: '主内容、目标平台，以及标题、描述、标签和封面是否需要自动整理。',
      remindsWhen: '草稿已准备好，或某个平台版本还需要你修改时提醒。',
      connectionSummary: '第一版只做内部草稿准备，不接真实发布 Provider。',
      riskSummary: '真实发布仍保持 R3 审批链；本阶段只准备草稿，不会自动发布。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“一稿多发准备”。' },
      { key: 'masterContentId', type: 'text', required: true, label: '主内容', helpText: '填写已上传主内容的编号。' },
      { key: 'targetPlatforms', type: 'multiselect', required: true, label: '目标平台', helpText: '先支持抖音和 B站两个平台版本。', options: [{ value: 'douyin', label: '抖音' }, { value: 'bilibili', label: 'B站' }] },
      { key: 'generateTitle', type: 'boolean', required: true, label: '自动整理标题', helpText: '按平台限制生成标题草稿。', defaultValue: true },
      { key: 'generateDescription', type: 'boolean', required: true, label: '自动整理描述', helpText: '按平台要求准备描述草稿。', defaultValue: true },
      { key: 'generateTags', type: 'boolean', required: true, label: '自动整理标签', helpText: '按平台限制控制标签数量。', defaultValue: true },
      { key: 'prepareCover', type: 'boolean', required: true, label: '检查封面准备', helpText: '按平台封面比例检查是否已具备封面。', defaultValue: true },
      { key: 'requireApprovalBeforePublish', type: 'boolean', required: true, label: '正式发布前需要确认', helpText: '即使将来接入真实平台，发布前也需要你的确认。', defaultValue: true },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒方式', helpText: '草稿准备好后按你的偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: videoMultiPlatformSchema,
    buildDefinition(config) {
      const parsed = videoMultiPlatformSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '视频一稿多发',
        description: '把主内容整理成多个平台的草稿和准备信息，不直接正式发布。',
        domain: 'content',
        automationLevel: 'L2',
        sources: [{
          sourceType: 'internal',
          config: {
            resource: 'master_content',
            masterContentId: parsed.masterContentId,
            targetPlatforms: parsed.targetPlatforms,
          },
          sortOrder: 0,
        }],
        triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
        conditions: [],
        actions: [
          { actionType: 'generate_content', config: { format: 'short_video', targetPlatforms: parsed.targetPlatforms, generateTitle: parsed.generateTitle, generateDescription: parsed.generateDescription, generateTags: parsed.generateTags, prepareCover: parsed.prepareCover }, stepOrder: 0 },
          { actionType: 'create_draft', config: { draftType: 'platform_variant', domain: 'content' }, stepOrder: 1 },
          { actionType: 'prepare_publish', config: { platform: 'multi_platform', domain: 'content', targetPlatforms: parsed.targetPlatforms, notificationPreference: parsed.notificationPreference, requireApprovalBeforePublish: parsed.requireApprovalBeforePublish, providerGate: 'DRAFT_ONLY' }, stepOrder: 2 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'content_prepare_result' }, stepOrder: 3 },
        ],
      };
    },
  },
  {
    key: 'daily-important-summary',
    templateVersion: '1',
    domain: 'work',
    group: '我的事情',
    name: '每日重要事项摘要',
    description: '每天只给你少而有用的事项，不把所有消息都堆过来。',
    icon: '摘要',
    status: 'published',
    automationLevel: 'L1',
    requiredConnectors: ['internal', 'gmail', 'google_calendar'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '只告诉你今天真正值得处理的事情，而不是把所有消息都堆过来。',
      runsWhen: '每天固定时间生成一次摘要。',
      dataNeeded: '内部事项、手动事件、测试邮件、测试日历，以及可选的真实邮件和真实日历候选事项。',
      remindsWhen: '有重要事项时给你一张摘要卡；没有重要事项时默认安静。',
      connectionSummary: '现在支持内部与测试数据，也可以接入 Gmail 和 Google Calendar 连接；未连接时只提示重新连接，不会把整条摘要链路打崩。',
      riskSummary: '只读和整理信息，不会自动回复邮件，也不会改动日历。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“每天早上先看重点”。' },
      { key: 'summaryTime', type: 'time', required: true, label: '摘要时间', helpText: '每天几点生成一份重点摘要。', defaultValue: '07:30' },
      { key: 'includedSources', type: 'multiselect', required: true, label: '摘要来源', helpText: '选择需要纳入重点判断的来源。', options: [{ value: 'internal_task', label: '内部事项' }, { value: 'manual_event', label: '手动事件' }, { value: 'test_email', label: '测试邮件' }, { value: 'test_calendar', label: '测试日历' }, { value: 'email', label: '邮件连接' }, { value: 'calendar', label: '日历连接' }] },
      { key: 'emailConnectionId', type: 'text', required: false, label: '邮件连接编号', helpText: '如果要读取真实邮件，填写已连接的 Gmail 连接编号。' },
      { key: 'calendarConnectionId', type: 'text', required: false, label: '日历连接编号', helpText: '如果要读取真实日历，填写已连接的 Calendar 连接编号。' },
      { key: 'lookAheadHours', type: 'number', required: true, label: '向前看多久', helpText: '未来多少小时内的事项参与重要性判断。', defaultValue: 24, min: 1, max: 168 },
      { key: 'includeCalendar', type: 'boolean', required: true, label: '包含日历类事项', helpText: '把手动事件和测试日历纳入摘要。', defaultValue: true },
      { key: 'includeMessages', type: 'boolean', required: true, label: '包含消息类事项', helpText: '把测试邮件和真实邮件纳入摘要。', defaultValue: true },
      { key: 'maxItems', type: 'number', required: true, label: '最多展示几项', helpText: '摘要里最多展示多少条重点事项。', defaultValue: 5, min: 1, max: 20 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒方式', helpText: '默认建议摘要提醒；如果没重要事项会保持安静。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: dailyImportantSummarySchema,
    buildDefinition(config) {
      const parsed = dailyImportantSummarySchema.parse(config);
      const sources: PlanDefinitionInput['sources'] = [{
        sourceType: 'internal',
        connectorKey: 'internal',
        config: {
          resource: 'important_item_candidates',
          includedSources: parsed.includedSources,
          lookAheadHours: parsed.lookAheadHours,
          includeCalendar: parsed.includeCalendar,
          includeMessages: parsed.includeMessages,
          maxItems: parsed.maxItems,
          ...(parsed.emailConnectionId ? { emailConnectionId: parsed.emailConnectionId } : {}),
          ...(parsed.calendarConnectionId ? { calendarConnectionId: parsed.calendarConnectionId } : {}),
        },
        sortOrder: 0,
      }];
      if (parsed.includedSources.includes('email')) sources.push({
        sourceType: 'email', connectorKey: 'gmail', connectionId: parsed.emailConnectionId ?? undefined,
        config: {}, sortOrder: sources.length,
      });
      if (parsed.includedSources.includes('calendar')) sources.push({
        sourceType: 'calendar', connectorKey: 'google_calendar', connectionId: parsed.calendarConnectionId ?? undefined,
        config: {}, sortOrder: sources.length,
      });
      return {
        name: parsed.planName?.trim() || '每日重要事项摘要',
        description: '每天汇总真正需要处理的事项，普通消息保持静默。',
        domain: 'work',
        automationLevel: 'L1',
        sources,
        triggers: scheduleFromTime(parsed.summaryTime),
        conditions: [],
        actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'daily_summary', maxItems: parsed.maxItems, lookAheadHours: parsed.lookAheadHours, notificationPreference: parsed.notificationPreference }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'daily_summary_ready' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'exam-study-plan',
    templateVersion: '1',
    domain: 'study',
    group: '我的事情',
    name: '考试学习计划',
    description: '围绕考试日期和每日学习时间，持续生成和调整学习安排。',
    icon: '学习',
    status: 'published',
    automationLevel: 'L2',
    requiredConnectors: ['internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['create_task', 'summarize', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['summary', 'important'], { silentOnSuccess: false }),
    details: {
      doesWhat: '围绕考试日期、每日学习时间和当前进度，生成当天学习任务并在漏学后重排后续安排。',
      runsWhen: '每天在你设定的学习时间自动生成当天任务，也支持手动补跑。',
      dataNeeded: '考试日期、科目、每日学习时长、目标和当前进度。',
      remindsWhen: '有新的学习任务、需要补漏，或到了每周复盘日时提醒。',
      connectionSummary: '第一版只依赖计划配置和内部运行时数据，不接真实日历。',
      riskSummary: '只生成学习任务、复盘摘要和提醒，不会替你发送外部消息或执行高风险动作。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“60 天冲刺教资笔试”。' },
      { key: 'examName', type: 'text', required: true, label: '考试名称', helpText: '例如“教资笔试”或“CPA 会计”。' },
      { key: 'examDate', type: 'date', required: true, label: '考试日期', helpText: '填写正式考试日期。' },
      { key: 'subjects', type: 'text', required: true, label: '考试科目', helpText: '用逗号分隔，例如“数学，英语，政治”。' },
      { key: 'dailyStudyMinutes', type: 'number', required: true, label: '每天学习时长', helpText: '每天计划学多久。', defaultValue: 60, min: 15, max: 1440 },
      { key: 'preferredStudyTime', type: 'time', required: true, label: '学习时间', helpText: '每天几点生成当天学习任务。', defaultValue: '20:00' },
      { key: 'target', type: 'text', required: true, label: '备考目标', helpText: '例如“60 天内完成三轮复习”。' },
      { key: 'currentProgress', type: 'number', required: true, label: '当前进度', helpText: '用 0 到 100 表示当前备考进度。', defaultValue: 0, min: 0, max: 100 },
      { key: 'weeklySummaryDay', type: 'select', required: true, label: '每周复盘日', helpText: '每周哪一天输出学习周总结。', defaultValue: 'sunday', options: [{ value: 'monday', label: '周一' }, { value: 'tuesday', label: '周二' }, { value: 'wednesday', label: '周三' }, { value: 'thursday', label: '周四' }, { value: 'friday', label: '周五' }, { value: 'saturday', label: '周六' }, { value: 'sunday', label: '周日' }] },
      { key: 'missedTaskStrategy', type: 'select', required: true, label: '漏学处理方式', helpText: '漏掉的学习任务，是优先补上，还是放进后续节奏里重排。', defaultValue: 'catch_up_today', options: [{ value: 'catch_up_today', label: '今天优先补上' }, { value: 'rebalance_future', label: '后续节奏重排' }] },
    ],
    configSchema: examStudyPlanSchema,
    buildDefinition(config) {
      const parsed = examStudyPlanSchema.parse(config);
      const subjects = parseDelimitedTextList(parsed.subjects);
      return {
        name: parsed.planName?.trim() || '考试学习计划',
        description: '按天生成学习任务、跟踪进度，并在漏学后只重排未来安排。',
        domain: 'study',
        automationLevel: 'L2',
        sources: [{
          sourceType: 'internal',
          config: {
            resource: 'study_plan',
            examName: parsed.examName,
            examDate: parsed.examDate,
            subjects,
            dailyStudyMinutes: parsed.dailyStudyMinutes,
            preferredStudyTime: parsed.preferredStudyTime,
            target: parsed.target,
            currentProgress: parsed.currentProgress,
            weeklySummaryDay: parsed.weeklySummaryDay,
            missedTaskStrategy: parsed.missedTaskStrategy,
          },
          sortOrder: 0,
        }],
        triggers: scheduleFromTime(parsed.preferredStudyTime),
        conditions: [],
        actions: [
          { actionType: 'create_task', config: { list: 'study_plan', domain: 'study' }, stepOrder: 0 },
          { actionType: 'summarize', config: { format: 'short', domain: 'study' }, stepOrder: 1 },
          { actionType: 'notify', config: { channel: 'in_app', priority: 'P2', eventType: 'study_plan_ready' }, stepOrder: 2 },
        ],
      };
    },
  },
  {
    key: 'device-consumable-reminder',
    templateVersion: '1',
    domain: 'device',
    group: '我的东西',
    name: '设备耗材提醒',
    description: '快到更换周期时提醒你，顺手准备耗材清单。',
    icon: '设备',
    status: 'published',
    automationLevel: 'L1',
    requiredConnectors: ['internal'],
    approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'prepare_purchase', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '根据设备耗材的更换周期估算剩余时间，快到阈值时提醒你并准备购买清单。',
      runsWhen: '每天自动检查一次，也支持你更新“已更换”时间后重新计算。',
      dataNeeded: '设备资料、耗材名称、上次更换时间、更换周期和提醒阈值。',
      remindsWhen: '剩余寿命接近阈值时提醒，或替你准备耗材清单。',
      connectionSummary: '第一版只使用手工维护的设备与耗材资料，不依赖真实设备 API。',
      riskSummary: '只停在提醒与准备购买清单，不会自动下单，也不会接真实支付。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“净水器滤芯提醒”。' },
      { key: 'deviceProfileId', type: 'text', required: true, label: '设备编号', helpText: '填写你已创建好的设备编号。' },
      { key: 'consumableId', type: 'text', required: true, label: '耗材编号', helpText: '填写需要跟踪的耗材编号。' },
      { key: 'preparationMode', type: 'select', required: true, label: '提醒方式', helpText: '只提醒，或直接准备内部购买清单。', defaultValue: 'shopping_list', options: [{ value: 'reminder', label: '提醒' }, { value: 'shopping_list', label: '准备购买清单' }] },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '快到更换阈值时按你的偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: deviceConsumableReminderSchema,
    buildDefinition(config) {
      const parsed = deviceConsumableReminderSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '设备耗材提醒',
        description: '根据更换周期提醒设备耗材，必要时准备购买清单，不自动购买。',
        domain: 'device',
        automationLevel: 'L2',
        sources: [{
          sourceType: 'internal',
          config: {
            resource: 'device_consumable',
            deviceProfileId: parsed.deviceProfileId,
            consumableId: parsed.consumableId,
            preparationMode: parsed.preparationMode,
          },
          sortOrder: 0,
        }],
        triggers: schedule('0 9 * * *'),
        conditions: [],
        actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'device', preparationMode: parsed.preparationMode }, stepOrder: 0 },
          ...(parsed.preparationMode === 'shopping_list'
            ? [{ actionType: 'prepare_purchase', config: { currency: 'CNY', domain: 'device', preparationMode: parsed.preparationMode }, stepOrder: 1 } as const]
            : []),
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'device_consumable_prepare' }, stepOrder: parsed.preparationMode === 'shopping_list' ? 2 : 1 },
        ],
      };
    },
  },
  {
    key: 'utility-bill-guard', templateVersion: '1', domain: 'billing', group: '我的钱',
    name: '水电气与宽带账单守护', description: '按类别盯住周期账单，正常不打扰，异常才提醒。', icon: '账单', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['compare', 'summarize', 'notify']), notificationPolicy: notificationPolicy('silent', ['silent', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '复用统一账单记录检查水费、电费、燃气或宽带。', runsWhen: '每月在指定日期检查。', dataNeeded: '对应类别的账单金额和月份。',
      remindsWhen: '金额超过阈值或相比上期异常上涨时。', connectionSummary: '使用现有 Billing Source，可来自手工、文件或后续正式 Connector。', riskSummary: '只比较和提醒，不缴费、不转账。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“家里电费守护”。' },
      { key: 'category', type: 'select', required: true, label: '账单类型', helpText: '选择要盯住的周期账单。', options: [{ value: '水费', label: '水费' }, { value: '电费', label: '电费' }, { value: '燃气', label: '燃气' }, { value: '宽带', label: '宽带' }] },
      { key: 'monthlyThreshold', type: 'number', required: true, label: '金额阈值', helpText: '超过这个金额才提醒。', min: 0, max: 1000000 },
      { key: 'increaseThresholdPercent', type: 'number', required: true, label: '上涨阈值', helpText: '相比上期上涨百分比。', defaultValue: 30, min: 1, max: 1000 },
      { key: 'checkDayOfMonth', type: 'number', required: true, label: '检查日期', helpText: '每月哪天检查。', defaultValue: 5, min: 1, max: 28 },
    ],
    configSchema: utilityBillGuardSchema,
    buildDefinition(config) {
      const parsed = utilityBillGuardSchema.parse(config);
      return { name: parsed.planName?.trim() || `${parsed.category}守护`, description: '周期账单异常时提醒，正常保持安静。', domain: 'billing', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', config: { resource: 'billing_records', billingPeriod: 'current_month', category: parsed.category }, sortOrder: 0 }],
        triggers: schedule(`0 10 ${parsed.checkDayOfMonth} * *`),
        conditions: [
          { groupId: 'root', logicalOperator: 'OR', fieldPath: 'amount', operator: 'GT', comparisonValue: parsed.monthlyThreshold, sortOrder: 0 },
          { groupId: 'root', logicalOperator: 'OR', fieldPath: 'amountChange', operator: 'PERCENT_CHANGE_GT', comparisonValue: parsed.increaseThresholdPercent, sortOrder: 1 },
        ],
        actions: [{ actionType: 'compare', config: { baseline: 'previous_period', enabled: true, anomalyThresholdPercent: parsed.increaseThresholdPercent }, stepOrder: 0 }, { actionType: 'summarize', config: { format: 'short', domain: 'billing' }, stepOrder: 1 }, { actionType: 'notify', config: { channel: 'in_app', priority: 'P1', eventType: 'utility_bill_anomaly' }, stepOrder: 2 }],
      };
    },
  },
  {
    key: 'abnormal-spend-guard', templateVersion: '1', domain: 'finance', group: '我的钱',
    name: '异常消费守护', description: '汇总并分类本月消费，只在总额或涨幅异常时提醒。', icon: '消费', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['classify', 'compare', 'summarize', 'notify']), notificationPolicy: notificationPolicy('important', ['summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '复用 Billing Records 做消费分类、环比和异常判断。', runsWhen: '每天检查当月累计情况。', dataNeeded: '账单类别、金额、日期。',
      remindsWhen: '累计金额或相比上月涨幅超过阈值。', connectionSummary: '不绑定某家支付平台，所有来源先归一到 Billing Source。', riskSummary: '不做投资、贷款决策、支付或转账。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“本月消费守护”。' },
      { key: 'amountThreshold', type: 'number', required: true, label: '累计金额阈值', helpText: '本月累计超过这个金额才提醒。', min: 0, max: 100000000 },
      { key: 'increaseThresholdPercent', type: 'number', required: true, label: '环比上涨阈值', helpText: '相比上月上涨百分比。', defaultValue: 50, min: 1, max: 1000 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '异常时使用摘要或重要提醒。', defaultValue: 'important', options: [{ value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: abnormalSpendGuardSchema,
    buildDefinition(config) {
      const parsed = abnormalSpendGuardSchema.parse(config);
      return { name: parsed.planName?.trim() || '异常消费守护', description: '分类、汇总并判断消费异常，不执行任何资金动作。', domain: 'finance', automationLevel: 'L1',
        sources: internalBillingSource('current_month'), triggers: schedule('0 21 * * *'),
        conditions: [
          { groupId: 'root', logicalOperator: 'OR', fieldPath: 'amount', operator: 'GT', comparisonValue: parsed.amountThreshold, sortOrder: 0 },
          { groupId: 'root', logicalOperator: 'OR', fieldPath: 'amountChange', operator: 'PERCENT_CHANGE_GT', comparisonValue: parsed.increaseThresholdPercent, sortOrder: 1 },
        ],
        actions: [{ actionType: 'classify', config: { taxonomy: 'billing_category', showCategories: true }, stepOrder: 0 }, { actionType: 'compare', config: { baseline: 'previous_period', enabled: true, anomalyThresholdPercent: parsed.increaseThresholdPercent }, stepOrder: 1 }, { actionType: 'summarize', config: { format: 'short', showCategories: true, showMonthOverMonth: true }, stepOrder: 2 }, { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'abnormal_spend_detected' }, stepOrder: 3 }],
      };
    },
  },
  {
    key: 'vehicle-care-reminder', templateVersion: '1', domain: 'vehicle', group: '我的东西',
    name: '车辆到期与保养提醒', description: '人工更新里程也能持续检查保险、年检和保养时间。', icon: '车辆', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '统一检查保险、年检、保养日期和保养里程，不需要车辆 API。', runsWhen: '每天按设定时间检查一次。',
      dataNeeded: '车辆资料、人工里程、保险和年检日期、保养日期或里程。', remindsWhen: '接近到期或里程阈值时提醒。',
      connectionSummary: '只使用你手工维护的 VehicleProfile。', riskSummary: '只整理和提醒，不代办保险、维修或付款。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“我的车保养提醒”。' },
      { key: 'profileId', type: 'text', required: true, label: '车辆编号', helpText: '选择已创建的车辆资料。' },
      { key: 'reminderTime', type: 'time', required: true, label: '检查时间', helpText: '每天几点检查。', defaultValue: '09:00' },
      { key: 'remindBeforeDays', type: 'number', required: true, label: '提前提醒天数', helpText: '距离到期多少天开始提醒。', defaultValue: 30, min: 1, max: 180 },
      { key: 'mileageBufferKm', type: 'number', required: true, label: '里程提前量', helpText: '距离保养里程多少公里开始提醒。', defaultValue: 500, min: 0, max: 10000 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '按你的偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: vehicleCareReminderSchema,
    buildDefinition(config) {
      const parsed = vehicleCareReminderSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '车辆到期与保养提醒', description: '检查车辆日期和人工里程，接近阈值时提醒。', domain: 'vehicle', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', config: { resource: 'vehicle_profile', profileId: parsed.profileId, remindBeforeDays: parsed.remindBeforeDays }, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.reminderTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'vehicle' }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'vehicle_care_due' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'digital-subscription-reminder', templateVersion: '1', domain: 'digital_account', group: '我的东西',
    name: '会员与订阅防浪费', description: '到期前提醒你决定续不续，不自动扣费或取消。', icon: '订阅', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']),
    notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '检查会员和订阅到期时间、连接状态与备份状态。', runsWhen: '每天按设定时间检查一次。',
      dataNeeded: '服务名、订阅状态、到期时间、连接和备份状态；绝不需要账号密码。', remindsWhen: '临近到期、安全提醒或备份落后时提醒。',
      connectionSummary: '只使用轻量 DigitalAccountProfile，不保存密码。', riskSummary: '只提醒，不自动续费、取消或修改账户权限。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“视频会员防浪费”。' },
      { key: 'profileId', type: 'text', required: true, label: '数字账号编号', helpText: '选择已创建的数字账号资料。' },
      { key: 'reminderTime', type: 'time', required: true, label: '检查时间', helpText: '每天几点检查。', defaultValue: '09:00' },
      { key: 'remindBeforeDays', type: 'number', required: true, label: '提前提醒天数', helpText: '距离到期多少天开始提醒。', defaultValue: 14, min: 1, max: 180 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '按你的偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: digitalSubscriptionReminderSchema,
    buildDefinition(config) {
      const parsed = digitalSubscriptionReminderSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '会员与订阅防浪费', description: '订阅到期前提醒，不自动续费或取消。', domain: 'digital_account', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', config: { resource: 'digital_account_profile', profileId: parsed.profileId, remindBeforeDays: parsed.remindBeforeDays }, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.reminderTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'digital_account' }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'digital_subscription_due' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'operations-daily-summary', templateVersion: '1', domain: 'operations', group: '我的事情',
    name: '经营事项日报', description: '把订单、库存、退款和供应记录整理成一份小日报，只突出异常。', icon: '经营', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']), notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '汇总当天的订单、库存、退款和供应记录。', runsWhen: '每天按设定时间整理一次。', dataNeeded: '轻量经营记录的类型、主题、数量、金额、状态和是否需要处理。',
      remindsWhen: '有库存、退款或供应异常等需要处理的记录时。', connectionSummary: '先使用手工、文件或内部归一记录，不接大型 ERP。', riskSummary: '只汇总与提醒，不改单、不退款、不采购。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“每天经营重点”。' },
      { key: 'summaryTime', type: 'time', required: true, label: '日报时间', helpText: '每天几点整理日报。', defaultValue: '21:00' },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '正常不打扰，有异常时按偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: operationsDailySummarySchema,
    buildDefinition(config) {
      const parsed = operationsDailySummarySchema.parse(config);
      return {
        name: parsed.planName?.trim() || '经营事项日报', description: '汇总经营记录并突出需要处理的异常。', domain: 'operations', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', connectorKey: 'internal', config: { resource: 'operational_records' }, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.summaryTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'operations', notificationPreference: parsed.notificationPreference }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'operations_attention_required' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'recurring-life-reminder', templateVersion: '1', domain: 'life', group: '我的生活',
    name: '周期事项提醒', description: '把保质期、房租和家庭周期事项放进同一个轻量清单，到期前再提醒。', icon: '周期', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']), notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '检查你手工维护的生活或住房周期事项。', runsWhen: '每天按设定时间检查。', dataNeeded: '事项名称、类别、下次到期日、周期和提前提醒天数。',
      remindsWhen: '进入提前提醒窗口或已经逾期时。', connectionSummary: '只使用统一 RecurringItemProfile，不需要额外平台连接。', riskSummary: '只提醒，不缴费、不下单，也不修改外部账户。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“房租和证件周期提醒”。' },
      { key: 'profileId', type: 'text', required: true, label: '周期事项', helpText: '选择已创建的生活或住房周期事项。' },
      { key: 'reminderTime', type: 'time', required: true, label: '检查时间', helpText: '每天几点检查。', defaultValue: '09:00' },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '正常保持安静，到期时按偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: recurringItemReminderSchema,
    buildDefinition(config) {
      const parsed = recurringItemReminderSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '周期事项提醒', description: '到期前提醒生活和住房周期事项。', domain: 'life', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', connectorKey: 'internal', config: { resource: 'recurring_item_profile', profileId: parsed.profileId }, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.reminderTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'recurring_item', notificationPreference: parsed.notificationPreference }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'recurring_item_due' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'work-follow-up-reminder', templateVersion: '1', domain: 'work', group: '我的事情',
    name: '工作跟进提醒', description: '用统一周期事项保存需要再次跟进的工作，到期才提醒。', icon: '跟进', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['internal'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']), notificationPolicy: notificationPolicy('summary', ['silent', 'summary', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '检查工作跟进的下次到期时间和重复周期。', runsWhen: '每天按设定时间检查。', dataNeeded: '跟进主题、下次时间、周期和提前提醒天数。',
      remindsWhen: '跟进进入提醒窗口或逾期时。', connectionSummary: '复用统一 RecurringItemProfile，不发展成 Office Suite。', riskSummary: '只提醒，不自动发邮件、不修改日历。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“客户方案跟进”。' },
      { key: 'profileId', type: 'text', required: true, label: '跟进事项', helpText: '选择工作领域的周期事项。' },
      { key: 'reminderTime', type: 'time', required: true, label: '检查时间', helpText: '每天几点检查。', defaultValue: '09:00' },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒强度', helpText: '到期时按偏好提醒。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: recurringItemReminderSchema,
    buildDefinition(config) {
      const parsed = recurringItemReminderSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '工作跟进提醒', description: '工作跟进进入提醒窗口时提醒。', domain: 'work', automationLevel: 'L1',
        sources: [{ sourceType: 'internal', connectorKey: 'internal', config: { resource: 'recurring_item_profile', profileId: parsed.profileId, expectedDomain: 'work' }, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.reminderTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'recurring_item', notificationPreference: parsed.notificationPreference }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: parsed.notificationPreference === 'important' ? 'P1' : 'P2', eventType: 'work_follow_up_due' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'calendar-conflict-guard', templateVersion: '1', domain: 'work', group: '我的事情',
    name: '日历冲突守护', description: '只读日历并找出时间重叠，有冲突才提醒。', icon: '日历', status: 'published', automationLevel: 'L1',
    requiredConnectors: ['google_calendar'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['summarize', 'notify']), notificationPolicy: notificationPolicy('silent', ['silent', 'important'], { silentOnSuccess: true }),
    details: {
      doesWhat: '比较日历事项的起止时间，找出重叠安排。', runsWhen: '每天按设定时间检查。', dataNeeded: '只读日历事件的标题和起止时间。',
      remindsWhen: '发现至少一组时间冲突时。', connectionSummary: '需要一个已授权“读取日历事件”的 Calendar 连接。', riskSummary: '只读取和比较，不创建、修改或删除日历事项。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“工作日历冲突守护”。' },
      { key: 'calendarConnectionId', type: 'text', required: true, label: '日历连接', helpText: '选择只读日历连接。' },
      { key: 'checkTime', type: 'time', required: true, label: '检查时间', helpText: '每天几点检查冲突。', defaultValue: '07:30' },
    ],
    configSchema: calendarConflictGuardSchema,
    buildDefinition(config) {
      const parsed = calendarConflictGuardSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '日历冲突守护', description: '只读日历并识别重叠安排，正常保持安静。', domain: 'work', automationLevel: 'L1',
        sources: [{ sourceType: 'calendar', connectorKey: 'google_calendar', connectionId: parsed.calendarConnectionId, config: {}, sortOrder: 0 }],
        triggers: scheduleFromTime(parsed.checkTime), conditions: [], actions: [
          { actionType: 'summarize', config: { format: 'short', domain: 'calendar_conflict' }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: 'P1', eventType: 'calendar_conflict_detected' }, stepOrder: 1 },
        ],
      };
    },
  },
  {
    key: 'file-archive-preparation', templateVersion: '1', domain: 'work', group: '我的事情',
    name: '工作文件归档准备', description: '读取你主动选择的文件信息，生成归档清单，不移动或删除原文件。', icon: '文件', status: 'published', automationLevel: 'L0',
    requiredConnectors: ['file_provider'], approvalPolicy: NEVER_APPROVAL_POLICY,
    riskConstraint: riskConstraint('R1', ['archive']), notificationPolicy: notificationPolicy('silent', ['silent'], { silentOnSuccess: true }),
    details: {
      doesWhat: '根据文件名和内容指纹准备一条可追踪的归档清单。', runsWhen: '你主动选择文件并运行时。', dataNeeded: '文件名、类型、大小和 SHA-256；计划不保存文件内容。',
      remindsWhen: '不额外打扰，结果留在执行记录。', connectionSummary: '使用本地文件选择器，只读取最小文件元数据。', riskSummary: '只准备归档信息，不移动、不覆盖、不删除文件。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“项目文件归档准备”。' },
      { key: 'fileConnectionId', type: 'text', required: true, label: '文件连接', helpText: '选择本地文件读取连接。' },
      { key: 'destination', type: 'select', required: true, label: '归档类别', helpText: '选择建议归入的类别。', defaultValue: '项目资料', options: [{ value: '项目资料', label: '项目资料' }, { value: '财务凭证', label: '财务凭证' }, { value: '行政资料', label: '行政资料' }, { value: '参考资料', label: '参考资料' }] },
    ],
    configSchema: fileArchivePreparationSchema,
    buildDefinition(config) {
      const parsed = fileArchivePreparationSchema.parse(config);
      return {
        name: parsed.planName?.trim() || '工作文件归档准备', description: '只准备归档清单，不移动或删除原文件。', domain: 'work', automationLevel: 'L0',
        sources: [{ sourceType: 'file', connectorKey: 'file_provider', connectionId: parsed.fileConnectionId, config: { metadataOnly: true }, sortOrder: 0 }],
        triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
        actions: [{ actionType: 'archive', config: { destination: parsed.destination }, stepOrder: 0 }],
      };
    },
  },
] as const;

export function listPlanTemplates() {
  return [...PLAN_TEMPLATES];
}

export function getPlanTemplateByKey(key: string) {
  return PLAN_TEMPLATES.find((template) => template.key === key);
}

export function resolvePlanTemplate(key: string, input?: Record<string, unknown>) {
  const template = getPlanTemplateByKey(key);
  if (!template) return null;
  return resolvePlanTemplateManifest(template, input);
}

export function resolvePlanTemplateManifest(template: PlanTemplateManifest, input?: Record<string, unknown>) {
  const config = template.configSchema.parse(input ?? {});
  const built = template.buildDefinition(config);
  const definition = validateResolvedPlanTemplate(template, config, {
    ...built,
    approvalPolicy: template.approvalPolicy,
  });
  return {
    manifest: template,
    config,
    definition,
    metadata: {
      templateKey: template.key,
      templateVersion: template.templateVersion,
      templateConfig: config,
    },
  } satisfies ResolvedPlanTemplate;
}

export function validateResolvedPlanTemplate(
  template: PlanTemplateManifest,
  config: Record<string, unknown>,
  definition: PlanDefinitionInput,
) {
  const normalized = normalizePlanDefinition(definition);
  if (JSON.stringify(normalized.approvalPolicy ?? null) !== JSON.stringify(template.approvalPolicy)) {
    throw new Error(`Template ${template.key} emitted an approvalPolicy outside the server contract`);
  }
  if (!template.notificationPolicy.allowedModes.includes(template.notificationPolicy.defaultMode)) {
    throw new Error(`Template ${template.key} notificationPolicy.defaultMode must be included in allowedModes`);
  }
  const requestedMode = typeof config.notificationPreference === 'string' ? config.notificationPreference : null;
  if (requestedMode && !template.notificationPolicy.allowedModes.includes(requestedMode as TemplateNotificationMode)) {
    throw new Error(`Template ${template.key} notification mode ${requestedMode} is not allowed by the server contract`);
  }
  const connectorRefs = [
    ...normalized.sources.map((source) => source.connectorKey).filter((item): item is string => Boolean(item)),
    ...normalized.actions.map((action) => action.connectorKey).filter((item): item is string => Boolean(item)),
  ];
  const undeclaredConnector = connectorRefs.find((item) => !template.requiredConnectors.includes(item));
  if (undeclaredConnector) {
    throw new Error(`Template ${template.key} references undeclared connector ${undeclaredConnector}`);
  }
  let highestRisk: RiskLevel = 'R0';
  for (const action of normalized.actions) {
    if (!template.riskConstraint.allowedActionTypes.includes(action.actionType)) {
      throw new Error(`Template ${template.key} emitted disallowed action ${action.actionType}`);
    }
    const declared = ACTION_DEFINITIONS[action.actionType];
    if (RISK_SCORE[action.riskLevel] > RISK_SCORE[template.riskConstraint.maxRiskLevel]) {
      throw new Error(`Template ${template.key} emitted ${action.actionType} above max risk ${template.riskConstraint.maxRiskLevel}`);
    }
    if (!template.riskConstraint.allowExternalSideEffect && declared.externalEffect) {
      throw new Error(`Template ${template.key} emitted external side-effect action ${action.actionType}`);
    }
    if (RISK_SCORE[action.riskLevel] > RISK_SCORE[highestRisk]) highestRisk = action.riskLevel;
  }
  if (!approvalPolicyMeetsSystemFloor(template.approvalPolicy, highestRisk)) {
    throw new Error(`Template ${template.key} approvalPolicy is below the system safety floor for ${highestRisk}`);
  }
  return {
    ...definition,
    approvalPolicy: template.approvalPolicy,
  } satisfies PlanDefinitionInput;
}

function approvalPolicyMeetsSystemFloor(policy: ApprovalPolicyDefinition, highestRisk: RiskLevel) {
  if (RISK_SCORE[highestRisk] < RISK_SCORE.R3) return true;
  if (policy.type === 'always' || policy.type === 'per_execution' || policy.type === 'temporary_authorization') return true;
  if (policy.type === 'above_risk_level') {
    const threshold = policy.config.riskLevel;
    return typeof threshold === 'string' && threshold in RISK_SCORE && RISK_SCORE[threshold as RiskLevel] <= RISK_SCORE.R3;
  }
  return false;
}
