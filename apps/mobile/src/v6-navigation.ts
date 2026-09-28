export interface V6Destination {
  label: string;
  path: string;
  icon: string;
}

export const TOP_DESTINATIONS: readonly V6Destination[] = [
  { label: '首页', path: '/', icon: 'home-outline' },
  { label: '计划', path: '/plans', icon: 'layers-outline' },
  { label: '资源', path: '/private', icon: 'cube-outline' },
  { label: '服务', path: '/services', icon: 'briefcase-outline' },
];

export const BOTTOM_ACTIONS = [
  { label: '消息', path: '/messages', icon: 'chatbubble-outline' },
  { label: '问一问', path: '/search-ai', icon: 'color-wand-outline' },
  { label: '待办', path: '/todo', icon: 'create-outline' },
] as const;

/** 顶层入口选中态：首页严格匹配，其余入口匹配自身及子路由。 */
export function isSelected(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}
