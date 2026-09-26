export interface V6Destination {
  label: string;
  path: string;
  icon: string;
}

export const TOP_DESTINATIONS: readonly V6Destination[] = [
  { label: '首页', path: '/', icon: 'home-outline' },
  { label: '计划', path: '/plans', icon: 'layers-outline' },
  { label: '私密', path: '/private', icon: 'lock-closed-outline' },
  { label: '商城', path: '/commerce', icon: 'bag-handle-outline' },
];

export const BOTTOM_ACTIONS = [
  { label: '消息', path: '/messages', icon: 'notifications-outline' },
  { label: '搜索或问万事问', path: '/search-ai', icon: 'sparkles-outline' },
  { label: '待办', path: '/todo', icon: 'checkbox-outline' },
] as const;

/** 顶层入口选中态：首页严格匹配，其余入口匹配自身及子路由。 */
export function isSelected(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}
