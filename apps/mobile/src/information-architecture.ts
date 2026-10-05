export const PRIMARY_ENTRIES = [
 {key:'schedule',label:'日程',responsibility:'全部运行、待处理与结果的统一时间轴'},
 {key:'plans',label:'计划',responsibility:'模板与我的计划'},
 {key:'chat',label:'会话',responsibility:'临时与计划两种工作上下文'},
 {key:'resources',label:'资源',responsibility:'本机、云端、其它设备与接口'},
 {key:'services',label:'服务',responsibility:'内部服务与外部服务'},
] as const;
export const SECONDARY_PAGES = {
 schedule:['日程详情','执行结果'],plans:['计划详情','计划方案确认','执行详情'],chat:['历史会话','创建草案'],
 resources:['设备管理','资源授权管理','接口管理'],services:['服务详情','服务个人工作台','我的服务','我的发布','服务设置'],
} as const;

/** These tab-backed routes are secondary pages and must not repeat the global shell. */
export function isSecondaryWorkspacePath(pathname: string) {
  return ['/create', '/records', '/connections', '/permissions'].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
