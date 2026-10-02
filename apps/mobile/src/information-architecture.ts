export const PRIMARY_ENTRIES = [
  { key: 'me', label: '我', responsibility: '个人账号、登录、偏好与应用设置' },
  { key: 'home', label: '首页', responsibility: '今日重点、正在运行、待处理与推荐' },
  { key: 'plans', label: '计划', responsibility: '计划管理、状态、历史与执行记录' },
  { key: 'resources', label: '资源', responsibility: '应用、数据、知识、设备与执行能力' },
  { key: 'services', label: '服务', responsibility: '服务发现、发布、外部供给与履约' },
  { key: 'messages', label: '消息', responsibility: '系统通知、动态与互动消息' },
  { key: 'ask', label: '问一问', responsibility: '聊天、问题分析与计划转化' },
  { key: 'todo', label: '待处理', responsibility: '审批、确认、异常与人工处理' },
] as const;

export const SECONDARY_PAGES = {
  me: ['编辑个人资料', '账号与验证', '登录与设备', '个人隐私设置', '偏好设置', '显示与提醒', 'AI 助手习惯', '帮助与反馈', '关于懒人装甲'],
  home: ['今日重点详情', '待处理详情'],
  plans: ['计划详情', '计划方案确认', '完整记录', '执行详情'],
  resources: ['应用连接管理', '数据与知识管理', '私密空间', '设备管理', '执行能力详情', '资源授权管理'],
  services: ['服务详情', '发布者主页', '发布管理', '服务履约详情', '关注与收藏'],
  messages: ['消息详情'],
  ask: ['历史对话', '上下文管理'],
  todo: ['审批与确认详情', '异常与核实详情'],
} as const;

/** These tab-backed routes are secondary pages and must not repeat the global shell. */
export function isSecondaryWorkspacePath(pathname: string) {
  return ['/create', '/records', '/connections', '/permissions'].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
