/**
 * Stable product taxonomy. These concepts answer different questions:
 * Domain/Scenario define what is managed, Strategy defines how it is managed,
 * and Lifecycle defines how every plan runs safely and repeatedly.
 */
export const PRODUCT_DOMAINS = [
  { key: 'finance', storageKey: 'finance', label: '财务', group: 'money' },
  { key: 'daily_life', storageKey: 'life', label: '日常事务', group: 'life' },
  { key: 'family', storageKey: 'family', label: '家庭', group: 'life' },
  { key: 'health', storageKey: 'health', label: '健康', group: 'life' },
  { key: 'social', storageKey: 'social', label: '社交关系', group: 'life' },
  { key: 'pet', storageKey: 'pet', label: '宠物', group: 'life' },
  { key: 'housing', storageKey: 'housing', label: '住房', group: 'life' },
  { key: 'travel', storageKey: 'travel', label: '出行', group: 'life' },
  { key: 'entertainment', storageKey: 'entertainment', label: '休闲娱乐', group: 'life' },
  { key: 'work', storageKey: 'work', label: '工作', group: 'work' },
  { key: 'operations', storageKey: 'operations', label: '运营', group: 'work' },
  { key: 'content', storageKey: 'content', label: '内容创作', group: 'work' },
  { key: 'study', storageKey: 'study', label: '学习', group: 'work' },
  { key: 'identity_docs', storageKey: 'identity_docs', label: '证件', group: 'work' },
  { key: 'government', storageKey: 'government', label: '政务', group: 'work' },
  { key: 'legal_contract', storageKey: 'legal_contract', label: '合同与法律事务', group: 'work' },
  { key: 'vehicle', storageKey: 'vehicle', label: '车辆', group: 'things' },
  { key: 'device', storageKey: 'device', label: '设备', group: 'things' },
  { key: 'digital_account', storageKey: 'digital_account', label: '数字账户', group: 'things' },
] as const;

export type ProductDomainKey = typeof PRODUCT_DOMAINS[number]['key'];
export type ProductDomain = typeof PRODUCT_DOMAINS[number];

type ScenarioSeed = readonly [key: string, label: string];
const SCENARIOS_BY_DOMAIN: Readonly<Record<ProductDomainKey, readonly ScenarioSeed[]>> = {
  finance: [['bill', '账单'], ['budget', '预算'], ['balance', '余额'], ['subscription', '订阅'], ['refund', '退款'], ['abnormal_transaction', '异常交易']],
  daily_life: [['delivery', '快递'], ['payment', '缴费'], ['subsidy', '补给'], ['appointment', '预约'], ['errands', '零碎待办']],
  family: [['family_supply', '家庭补给'], ['member_affairs', '成员事项'], ['household_tasks', '家庭分工'], ['shared_resources', '共享资源'], ['household_expense', '家庭公共费用']],
  health: [['medication', '用药'], ['follow_up', '复诊'], ['physical_exam', '体检'], ['health_records', '健康资料'], ['habit_trends', '习惯与指标趋势']],
  social: [['important_contacts', '重要联系人'], ['pending_reply', '待回复'], ['anniversary', '纪念日'], ['gathering_invitation', '聚会邀请']],
  pet: [['vaccination_deworming', '疫苗驱虫'], ['feeding_supply', '喂养补给'], ['grooming', '洗护'], ['health_follow_up', '健康复诊']],
  housing: [['rent', '房租'], ['utilities', '物业水电'], ['lease', '租约'], ['maintenance', '维修'], ['home_care', '房屋保养']],
  travel: [['itinerary', '行程'], ['tickets', '票务'], ['departure_prepare', '出发准备'], ['accommodation', '住宿'], ['trip_abnormal', '行程异常']],
  entertainment: [['media_games', '影视游戏'], ['events', '演出活动'], ['collections', '收藏清单'], ['entertainment_subscription', '娱乐订阅']],
  work: [['tasks', '任务'], ['meetings', '会议'], ['email', '邮件'], ['files', '文件'], ['recurring_work', '周期工作'], ['work_summary', '工作摘要']],
  operations: [['orders', '订单'], ['inventory', '库存'], ['customers', '客户'], ['after_sales', '售后'], ['campaigns', '活动'], ['business_metrics', '经营数据']],
  content: [['topics', '选题'], ['assets', '素材'], ['creation', '创作'], ['cross_publish', '一稿多发'], ['publishing', '发布'], ['retrospective', '复盘']],
  study: [['courses', '课程'], ['review', '复习'], ['exams', '考试'], ['materials', '资料'], ['learning_progress', '学习进度']],
  identity_docs: [['validity', '有效期'], ['renewal', '换证'], ['preparation', '材料准备'], ['document_records', '证件资料']],
  government: [['social_security_fund', '社保公积金'], ['tax', '税务'], ['government_services', '政务办理'], ['government_notices', '政府通知']],
  legal_contract: [['renewal', '到期续约'], ['payment_milestone', '付款节点'], ['performance_milestone', '履约节点'], ['contract_risk', '合同风险']],
  vehicle: [['maintenance', '保养'], ['insurance', '保险'], ['inspection', '年检'], ['energy', '能源'], ['abnormal', '异常'], ['daily', '车辆日常']],
  device: [['warranty', '保修'], ['consumables', '耗材'], ['maintenance', '维护'], ['abnormal', '异常'], ['renewal', '续费'], ['status', '设备状态']],
  digital_account: [['login_security', '登录安全'], ['oauth', 'OAuth 授权'], ['connection_health', '连接健康'], ['memberships', '会员订阅'], ['storage', '容量资源'], ['account_cleanup', '账号清理']],
};

export const CANONICAL_SCENARIOS = PRODUCT_DOMAINS.flatMap((domain) =>
  SCENARIOS_BY_DOMAIN[domain.key].map(([key, label]) => ({ key, label, domain: domain.key })),
);

export const PLAN_STRATEGIES = [
  { key: 'STATE_GUARD', label: '状态守护', consumerLabel: '持续关注状态' },
  { key: 'EXPIRY_GUARD', label: '到期守护', consumerLabel: '留意日期与周期' },
  { key: 'ANOMALY_DETECTION', label: '异常发现', consumerLabel: '发现和平时不同的变化' },
  { key: 'SILENT_FOLLOW_UP', label: '静默跟进', consumerLabel: '正常不打扰，变化才通知' },
  { key: 'PERIODIC_SUMMARY', label: '周期汇总', consumerLabel: '按周期整理重点' },
  { key: 'PREDICTIVE_PREPARE', label: '预测准备', consumerLabel: '提前准备下一步' },
  { key: 'ASSISTED_ACTION', label: '辅助执行', consumerLabel: '系统准备，你来确认' },
  { key: 'AUTOMATED_ACTION', label: '自动执行', consumerLabel: '在授权范围内自动完成' },
] as const;

export const PLAN_EXECUTION_LIFECYCLE = [
  { step: 1, key: 'CONNECTION_CAPABILITY', label: '确认连接与能力' },
  { step: 2, key: 'SOURCE_ACQUISITION', label: '获取现实数据' },
  { step: 3, key: 'NORMALIZE_DEDUPLICATE', label: '整理并去重' },
  { step: 4, key: 'CANDIDATE', label: '生成候选事实' },
  { step: 5, key: 'TRUTH', label: '确认为可信事实' },
  { step: 6, key: 'TRIGGER', label: '判断是否触发' },
  { step: 7, key: 'CONDITION', label: '判断条件是否成立' },
  { step: 8, key: 'RISK', label: '判断风险' },
  { step: 9, key: 'APPROVAL', label: '必要时请你确认' },
  { step: 10, key: 'CAPABILITY_RESOLUTION', label: '选择执行方式' },
  { step: 11, key: 'EXECUTION', label: '执行动作' },
  { step: 12, key: 'VERIFICATION', label: '验证真实结果' },
  { step: 13, key: 'RESULT', label: '形成结果' },
  { step: 14, key: 'FALLBACK_RECONCILIATION', label: '处理失败或不确定' },
  { step: 15, key: 'RECORD_AUDIT', label: '记录与安全审计' },
] as const;

export function productDomainFromStorageKey(storageKey: string | null | undefined): ProductDomain | null {
  if (!storageKey) return null;
  return PRODUCT_DOMAINS.find((domain) => domain.storageKey === storageKey || domain.key === storageKey) ?? null;
}

export function scenariosForDomain(domain: string | null | undefined) {
  const productDomain = productDomainFromStorageKey(domain);
  return productDomain ? CANONICAL_SCENARIOS.filter((scenario) => scenario.domain === productDomain.key) : [];
}
