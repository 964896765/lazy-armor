import type { AutomationLevel, PlanDefinitionInput } from '@lazy-armor/plan-schema';
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
  details: TemplateDetailContent;
  configFields: TemplateConfigField[];
  configSchema: z.ZodObject<z.ZodRawShape>;
  buildDefinition(config: Record<string, unknown>): PlanDefinitionInput;
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
  includedSources: z.array(z.enum(['internal_task', 'manual_event', 'test_email', 'test_calendar'])).min(1).max(4),
  lookAheadHours: z.number().int().min(1).max(24 * 7).default(24),
  includeCalendar: z.boolean().default(true),
  includeMessages: z.boolean().default(true),
  maxItems: z.number().int().min(1).max(20).default(5),
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
        approvalPolicy: { type: 'above_risk_level', config: { riskLevel: 'R3' } },
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
    requiredConnectors: ['internal'],
    details: {
      doesWhat: '只告诉你今天真正值得处理的事情，而不是把所有消息都堆过来。',
      runsWhen: '每天固定时间生成一次摘要。',
      dataNeeded: '内部事项、手动事件、测试邮件和测试日历等候选事项。',
      remindsWhen: '有重要事项时给你一张摘要卡；没有重要事项时默认安静。',
      connectionSummary: '第一版先支持内部与测试数据，真实邮件和日历留到 P2。',
      riskSummary: '只读和整理信息，不会自动回复邮件，也不会改动日历。',
    },
    configFields: [
      { key: 'planName', type: 'text', required: false, label: '计划名称', helpText: '例如“每天早上先看重点”。' },
      { key: 'summaryTime', type: 'time', required: true, label: '摘要时间', helpText: '每天几点生成一份重点摘要。', defaultValue: '07:30' },
      { key: 'includedSources', type: 'multiselect', required: true, label: '摘要来源', helpText: '选择需要纳入重点判断的来源。', options: [{ value: 'internal_task', label: '内部事项' }, { value: 'manual_event', label: '手动事件' }, { value: 'test_email', label: '测试邮件' }, { value: 'test_calendar', label: '测试日历' }] },
      { key: 'lookAheadHours', type: 'number', required: true, label: '向前看多久', helpText: '未来多少小时内的事项参与重要性判断。', defaultValue: 24, min: 1, max: 168 },
      { key: 'includeCalendar', type: 'boolean', required: true, label: '包含日历类事项', helpText: '把手动事件和测试日历纳入摘要。', defaultValue: true },
      { key: 'includeMessages', type: 'boolean', required: true, label: '包含消息类事项', helpText: '把测试邮件纳入摘要。', defaultValue: true },
      { key: 'maxItems', type: 'number', required: true, label: '最多展示几项', helpText: '摘要里最多展示多少条重点事项。', defaultValue: 5, min: 1, max: 20 },
      { key: 'notificationPreference', type: 'select', required: true, label: '提醒方式', helpText: '默认建议摘要提醒；如果没重要事项会保持安静。', defaultValue: 'summary', options: [{ value: 'silent', label: '静默' }, { value: 'summary', label: '摘要提醒' }, { value: 'important', label: '重要提醒' }] },
    ],
    configSchema: dailyImportantSummarySchema,
    buildDefinition(config) {
      const parsed = dailyImportantSummarySchema.parse(config);
      return {
        name: parsed.planName?.trim() || '每日重要事项摘要',
        description: '每天汇总真正需要处理的事项，普通消息保持静默。',
        domain: 'work',
        automationLevel: 'L1',
        sources: [{
          sourceType: 'internal',
          config: {
            resource: 'important_item_candidates',
            includedSources: parsed.includedSources,
            lookAheadHours: parsed.lookAheadHours,
            includeCalendar: parsed.includeCalendar,
            includeMessages: parsed.includeMessages,
            maxItems: parsed.maxItems,
          },
          sortOrder: 0,
        }],
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
    requiredConnectors: ['manual', 'calendar', 'internal'],
    details: {
      doesWhat: '围绕考试日期和每日学习时间生成学习安排，并支持后续重排。',
      runsWhen: '每天晚间生成下一步学习任务。',
      dataNeeded: '考试日期、科目、目标、学习时间和当前进度。',
      remindsWhen: '需要你补学习或复盘时提醒。',
      connectionSummary: '第一版先使用手动与内部数据。',
      riskSummary: '只生成计划和提醒，不会替你做高风险动作。',
    },
    configFields: [],
    configSchema: z.object({}).strict(),
    buildDefinition() {
      return {
        name: '考试学习计划',
        description: '按天生成学习任务，支持后续根据进度调整。',
        domain: 'study',
        automationLevel: 'L2',
        sources: manualSource,
        triggers: schedule('0 20 * * *'),
        conditions: [],
        actions: [
          { actionType: 'create_task', config: { list: 'study_plan' }, stepOrder: 0 },
          { actionType: 'summarize', config: { format: 'short' }, stepOrder: 1 },
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
    requiredConnectors: ['manual', 'device'],
    details: {
      doesWhat: '根据更换周期估算设备耗材剩余时间，提前提醒你准备。',
      runsWhen: '每周自动检查一次。',
      dataNeeded: '设备类型、耗材名称、上次更换时间和预计剩余寿命。',
      remindsWhen: '快到更换阈值时提醒。',
      connectionSummary: '第一版先用手工输入或内部资料。',
      riskSummary: '只做准备清单和提醒，不自动购买。',
    },
    configFields: [],
    configSchema: z.object({}).strict(),
    buildDefinition() {
      return {
        name: '设备耗材提醒',
        description: '根据更换周期提醒设备耗材，不自动购买。',
        domain: 'device',
        automationLevel: 'L1',
        sources: manualSource,
        triggers: schedule('0 9 * * 1'),
        conditions: [
          { groupId: 'root', logicalOperator: 'AND', fieldPath: 'remainingDays', operator: 'LTE', comparisonValue: 14, sortOrder: 0 },
        ],
        actions: [
          { actionType: 'prepare_purchase', config: { currency: 'CNY' }, stepOrder: 0 },
          { actionType: 'notify', config: { channel: 'in_app', priority: 'P2', eventType: 'device_consumable_prepare' }, stepOrder: 1 },
        ],
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
  const config = template.configSchema.parse(input ?? {});
  const definition = template.buildDefinition(config);
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
