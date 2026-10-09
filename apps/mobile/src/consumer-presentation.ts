/** Presentation only: never establishes health, authorization or execution success. */
const reasons: Record<string, string> = {
 SCENARIO_NOT_RESOLVED: '还需要明确计划类型', SUBJECT_NOT_SELECTED: '请选择这个计划使用的资源',
 SCENARIO_REVISION_CHANGED: '计划类型已更新，请重新确认', SCENARIO_CONTRACT_CHANGED: '计划配置已更新，请重新确认',
 SCENARIO_CONTRACT_V2_REQUIRED: '还需要补充资源配置', SCENARIO_CONTRACT_V2_UNAVAILABLE: '当前计划类型还需完善资源配置',
 SOURCE_NOT_SELECTED: '请选择数据来源', SUBJECT_REQUIRED: '请选择计划关联对象', SOURCE_CHOICE_REQUIRED: '请选择数据来源',
 PROVIDER_UNAVAILABLE: '当前数据来源暂不可用', PROVIDER_NOT_CONNECTED: '请连接数据来源',
 NO_CAPABILITY_PROVIDER: '暂时没有可提供此能力的资源', DEVICE_NOT_ONLINE: '设备暂未在线',
 BLOCKED_PROVIDER: '还需要连接可用资源', BLOCKED_FACT: '还需要补充信息', NEEDS_SUBJECT: '请选择资源',
 AI_PROVIDER_BALANCE_INSUFFICIENT: 'AI 服务余额不足，请充值后重试', AI_NOT_CONFIGURED: '请先配置 AI 服务',
 AUTH_REQUIRED: '需要重新授权', AUTH_EXPIRED: '授权已过期，请重新连接', PERMISSION_DENIED: '尚未获得所需授权',
 HEALTH_UNKNOWN: '暂未取得可用状态', NEEDS_RECONFIRMATION: '请重新确认计划配置',
 RUNNING: '运行中', ATTENTION: '待处理', PAUSED: '已暂停', ENDED: '已结束', ACTIVE: '进行中',
 PENDING: '待确认', BOOKED: '已预约', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
 PUBLISHED: '已发布', DRAFT: '草稿', REVOKED: '已撤销', EXTRACTED: '已提取文字',
 succeeded: '已完成', failed: '未完成', executing: '执行中', pending: '待处理', cancelled: '已取消',
 awaiting_approval: '等待确认', outcome_unknown: '结果待核实', approved: '已确认', rejected: '已拒绝',
 READY: '可以继续', BLOCKED: '需要补充', UNKNOWN: '状态待检查', SUCCEEDED: '已完成', FAILED: '未完成',
};
const internalCode = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;
const technical = /OAuth|\bScenario\s+[a-z]|Execution\s*ID|\b(?:outbox|schema|worker|capabilityKey|connectionId|planVersionId|structuredPayload)\b|\b(?:truths|capabilities|tools)\s*(?:为空|=|\/)|\bmanual\/internal\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/i;
export const ConsumerPresentationMapper = {
 capability(value: string) { return ({ 'notification.send': '发送提醒', 'notification.read': '读取消息', 'app.notification.read': '读取已授权的应用通知', 'calendar.event.read': '读取日历事项', 'calendar.event.create': '创建外部日历事项', 'calendar.event.update': '修改外部日历事项', 'calendar.event.delete': '删除外部日历事项', 'calendar.read': '读取日历', 'calendar.write': '创建日程', 'email.read': '读取邮件', 'email.send': '发送邮件', 'file.read': '读取文件', 'http.json.read': '读取接口数据' } as Record<string,string>)[value] ?? (/^[a-z][a-z0-9_.:-]+$/i.test(value) ? '所需数据与操作权限' : this.text(value, '所需数据与操作权限')); },
 reason(value: string) { return reasons[value] ?? (value.startsWith('MISSING_FACT:') ? '还需要补充计划信息' : value.startsWith('MISSING_CAPABILITY:') ? '还需要补充可用资源' : technical.test(value) || internalCode.test(value) ? '需要补充信息或检查资源授权' : this.text(value, '需要补充信息或检查资源授权')); },
 text(value: string | null | undefined, fallback = '') {
  if (!value) return fallback;
  if (/^E2E[_—-]/i.test(value)) return '开发验收记录';
  if (reasons[value]) return reasons[value];
  if (technical.test(value) || internalCode.test(value)) return fallback || '请查看相关信息并继续完善';
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, date => this.dateTime(date));
 },
 error(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '');
  if (/OAuth|configuration.*missing/i.test(message)) return '当前服务暂未开放，请稍后再试';
  if (/401|登录|token/i.test(message)) return '登录已过期，请重新登录';
  if (/余额|BALANCE_INSUFFICIENT/i.test(message)) return 'AI 服务余额不足，请充值后重试';
  if (/HTTP.*Key|HTTPS|密钥/i.test(message)) return '请连接安全服务器后配置密钥';
  if (/网络|timeout|fetch|超时/i.test(message)) return '连接暂时不可用，请检查网络后重试';
  if (/[\u4e00-\u9fff]/.test(message) && !technical.test(message) && !internalCode.test(message)) return message;
  return '暂时无法完成，请稍后重试';
 },
 timeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; },
 localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; },
 dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间待确认' : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); },
 time(value: string | null) { if (!value) return '未定时'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间待确认' : date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}); },
 domain(value: string) { return ({life:'日常',living:'生活',family:'家庭',health:'健康',finance:'财务',work:'工作',study:'学习',information:'信息',travel:'出行',social:'社交',entertainment:'娱乐',asset:'资产',identity:'事务'} as Record<string,string>)[value] ?? '其它'; },
};
