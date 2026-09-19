export interface PrivacyCenterSection {
  key: string;
  title: string;
  description: string;
  icon: string;
  route: string;
}

export function privacyCenterSections(): PrivacyCenterSection[] {
  return [
    { key: 'data', title: '我的数据', description: '按财务、生活、设备等领域查看装甲掌握的事实与来源', icon: 'server-outline', route: '/privacy-center/data' },
    { key: 'connections', title: '连接与授权', description: '管理在线服务、手机应用与设备的授权范围', icon: 'link-outline', route: '/connections' },
    { key: 'permissions', title: '设备权限', description: '通知、分享、屏幕读取等系统权限的使用方式', icon: 'key-outline', route: '/privacy-center/permissions' },
    { key: 'retention', title: '数据保留', description: '哪些数据可以删除，哪些必须保留用于审计', icon: 'archive-outline', route: '/data-management' },
    { key: 'ai', title: 'AI 与模型', description: 'AI 能做什么、不能做什么，以及视觉读取策略', icon: 'sparkles-outline', route: '/privacy-center/ai' },
    { key: 'security', title: '安全记录', description: '查看确认、授权与重要操作记录', icon: 'shield-checkmark-outline', route: '/security-activity' },
  ];
}

export type ConsumerDataDomain = '财务' | '生活' | '快递' | '设备' | '工作' | '学习' | '车辆' | '家庭' | '其他';

const DOMAIN_BY_RESOURCE: Record<string, ConsumerDataDomain> = {
  Transaction: '财务', AccountBalance: '财务', Bill: '财务', Budget: '财务', Subscription: '财务', Refund: '财务', Invoice: '财务',
  Shipment: '快递', Order: '快递', Product: '生活',
  Device: '设备', DeviceStatus: '设备', Consumable: '设备', Warranty: '设备', DeviceSubscription: '设备',
  CalendarEvent: '工作', Task: '工作', EmailMessage: '工作', Repository: '工作', Issue: '工作', PullRequest: '工作', Workflow: '工作', Contact: '工作', Conversation: '工作', Page: '工作', DataSource: '工作',
  LearningRecord: '学习',
  Vehicle: '车辆', VehicleServiceRecord: '车辆', VehicleInsurance: '车辆', VehicleInspection: '车辆', VehicleDiagnostic: '车辆',
  Household: '家庭', HouseholdMember: '家庭', HouseholdTask: '家庭', SupplyItem: '家庭', UtilityAccount: '家庭',
  HealthRecord: '生活', PetRecord: '家庭', Trip: '生活', Ticket: '生活', Booking: '生活', Place: '生活',
};

export function consumerDataDomain(resourceType: string | null | undefined): ConsumerDataDomain {
  return (resourceType && DOMAIN_BY_RESOURCE[resourceType]) || '其他';
}

export const CONSUMER_DATA_DOMAINS: ConsumerDataDomain[] = ['财务', '生活', '快递', '设备', '工作', '学习', '车辆', '家庭', '其他'];

export function consumerDataDomainSubtitle(domain: ConsumerDataDomain): string {
  switch (domain) {
    case '财务': return '账单、消费、订阅和账户余额';
    case '生活': return '行程、预订和日常安排';
    case '快递': return '包裹和物流状态';
    case '设备': return '耗材、保修和设备状态';
    case '工作': return '日历、邮件、任务和内容';
    case '学习': return '学习计划与进度';
    case '车辆': return '保养、保险和年检';
    case '家庭': return '家庭补给与生活缴费';
    default: return '其他暂未归类的数据';
  }
}

export interface TruthDataRow {
  id: string;
  factKey: string;
  resourceType?: string | null;
  valueSummary?: string | null;
  sourceLabel?: string | null;
  observedAt?: string | null;
  realityLevel?: string | null;
  usedByPlanNames?: string[];
}

export interface TruthDataPresentation {
  id: string;
  domain: ConsumerDataDomain;
  factLabel: string;
  valueSummary: string;
  sourceLabel: string;
  observedAt: string;
  realityLabel: string;
  usedByPlans: string;
}

export function presentTruthDataRow(row: TruthDataRow): TruthDataPresentation {
  const reality = ({ CLAIMED: '待确认', OBSERVED: '已观察', CORROBORATED: '已佐证', VERIFIED: '已验证' } as Record<string, string>)[row.realityLevel ?? ''] ?? '未验证';
  const observed = row.observedAt ? new Date(row.observedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未记录';
  const used = (row.usedByPlanNames?.length ?? 0) > 0 ? row.usedByPlanNames!.join('、') : '暂无计划使用';
  return {
    id: row.id,
    domain: consumerDataDomain(row.resourceType),
    factLabel: factKeyLabel(row.factKey),
    valueSummary: row.valueSummary ?? '—',
    sourceLabel: row.sourceLabel ?? '未知来源',
    observedAt: observed,
    realityLabel: reality,
    usedByPlans: used,
  };
}

export function factKeyLabel(factKey: string): string {
  const known: Record<string, string> = {
    'device.consumable.remaining_days': '滤芯预计剩余天数',
    'device.consumable.remaining': '耗材预计剩余',
    'shipment.status': '快递状态',
    'shipment.estimated_delivery': '预计送达时间',
    'billing.transaction.amount': '消费金额',
    'household.supply.days_until_run_out': '用品预计剩余时间',
    'vehicle.service.due_days': '保养剩余天数',
  };
  return known[factKey] ?? factKey.replaceAll('_', ' ');
}

export type TruthDeletionBoundary =
  | 'STOP_COLLECTING'
  | 'DISCONNECT_SOURCE'
  | 'REVOKE_AUTHORIZATION'
  | 'DELETE_USER_DATA'
  | 'DELETE_IMPORTED_FILE'
  | 'DELETE_DERIVED_FACT'
  | 'RETAIN_AUDIT_RECORD';

export function truthDeletionBoundaryLabel(boundary: TruthDeletionBoundary): string {
  switch (boundary) {
    case 'STOP_COLLECTING': return '停止采集';
    case 'DISCONNECT_SOURCE': return '断开来源';
    case 'REVOKE_AUTHORIZATION': return '撤销授权';
    case 'DELETE_USER_DATA': return '删除由你控制的数据';
    case 'DELETE_IMPORTED_FILE': return '删除导入的文件';
    case 'DELETE_DERIVED_FACT': return '删除派生的当前事实';
    case 'RETAIN_AUDIT_RECORD': return '保留必要的审计记录';
  }
}

export function truthDeletionBoundaryCopy(boundary: TruthDeletionBoundary): string {
  switch (boundary) {
    case 'STOP_COLLECTING': return '系统停止继续采集，但不会直接删除已经沉淀的历史事实。';
    case 'DISCONNECT_SOURCE': return '断开来源后，相关计划会保留但停止读取。';
    case 'REVOKE_AUTHORIZATION': return '撤销后来源无法继续读取，凭证会失效。';
    case 'DELETE_USER_DATA': return '删除你在应用里手动填写或由你控制的数据。';
    case 'DELETE_IMPORTED_FILE': return '删除你导入的文件及其派生的临时内容。';
    case 'DELETE_DERIVED_FACT': return '删除由系统派生出的当前事实，历史审计记录仍保留。';
    case 'RETAIN_AUDIT_RECORD': return '与执行、审批、授权相关的记录会保留，用于安全审计。';
  }
}

export function deleteImpactText(planNames: string[], domainLabel: string): string {
  const scope = planNames.length > 0 ? `将影响 ${planNames.length} 个计划（${planNames.join('、')}）` : '当前没有计划在使用这些数据';
  return `删除后${domainLabel}相关提醒可能暂时无法运行，历史执行记录仍保留必要审计信息。${scope}。`;
}

export function disconnectImpactText(planNames: string[]): string {
  if (planNames.length === 0) return '断开后没有计划会受到影响。';
  return `将影响 ${planNames.length} 个计划：${planNames.join('、')}。`;
}

export function disconnectSteps(): string[] {
  return ['断开连接', '撤销授权（如果来源支持）', '凭证失效', '连接不可用', '能力就绪度更新', '关联计划受影响', '今天提醒你'];
}

export interface DevicePermissionCopy {
  key: string;
  title: string;
  description: string;
}

export function devicePermissionCopy(): DevicePermissionCopy[] {
  return [
    { key: 'notification_read', title: '通知读取', description: '只读取你开启的指定来源通知，用于提取计划需要的字段，不读取无关通知。' },
    { key: 'share_receive', title: '分享接收', description: '只接收你主动分享给装甲的内容，不会在后台自行截取。' },
    { key: 'foreground_app_read', title: '前台应用读取', description: '只在你打开的应用会话中按需读取，不会持续监控屏幕。' },
    { key: 'structured_read', title: '结构化读取', description: '从支持的 App 中提取指定字段，优先走结构化方式。' },
    { key: 'screen_read', title: '屏幕内容读取', description: '仅在你启动的读取会话中，只读取支持的 App，按计划需要提取指定字段。' },
  ];
}

export function visionPrivacyCopy(): string {
  return '视觉读取：默认关闭自动截图兜底，只有结构化读取失败时才使用，且只提取计划需要的字段。';
}

export function aiCapabilityCopy(): { allowed: string[]; forbidden: string[] } {
  return {
    allowed: ['理解需求', '生成计划草稿', '解释计划状态', '分析已有事实'],
    forbidden: ['支付', '批准操作', '删除重要数据', '绕过授权执行动作'],
  };
}

export interface AgentPlanProposalInput {
  intentSummary?: string | null;
  explanation?: string | null;
  requiredFacts?: readonly string[];
  requiredCapabilities?: readonly string[];
  toolRequirements?: readonly { toolName: string; requiresApproval: boolean }[];
  warnings?: readonly string[];
}

export interface AgentProposalPresentation {
  title: string;
  intent: string;
  dataUsed: string;
  connectionsNeeded: string;
  actions: string[];
  needsConfirmation: boolean;
}

export function presentAgentPlanProposal(proposal: AgentPlanProposalInput): AgentProposalPresentation {
  const actions = (proposal.toolRequirements ?? []).map((tool) => tool.toolName);
  const facts = (proposal.requiredFacts ?? []).map(factKeyLabel);
  const capabilities = (proposal.requiredCapabilities ?? []).map(factKeyLabel);
  return {
    title: '我为你准备了一个计划',
    intent: proposal.intentSummary ?? proposal.explanation ?? '根据你的需求生成的一份计划草稿。',
    dataUsed: facts.length > 0 ? `使用这些数据：${facts.join('、')}` : '暂不需要额外数据。',
    connectionsNeeded: capabilities.length > 0 ? `需要这些连接：${capabilities.join('、')}` : '暂不需要额外连接。',
    actions: actions.length > 0 ? actions : ['按计划提醒你'],
    needsConfirmation: (proposal.toolRequirements ?? []).some((tool) => tool.requiresApproval),
  };
}

export function clarificationQuestion(missingRequirements: readonly string[]): string {
  const key = (missingRequirements ?? [])[0];
  if (!key) return '能再补充一些细节吗？';
  if (key === 'intent_too_vague') return '可以再说得具体一点吗？';
  if (key.includes('threshold') || key.includes('days')) return '你希望低于多少天提醒？';
  if (key.includes('amount') || key.includes('price')) return '你希望金额达到多少时提醒？';
  return '还差一点信息，请补充后再继续。';
}
