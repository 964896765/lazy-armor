export interface V6Destination {
  label: string;
  path: string;
  icon: string;
}

export const PRIMARY_DESTINATIONS: readonly V6Destination[] = [
  { label: '首页', path: '/', icon: 'home-outline' },
  { label: '计划', path: '/plans', icon: 'calendar-outline' },
  { label: '聊天', path: '/chat', icon: 'chatbubble-ellipses-outline' },
  { label: '资源', path: '/private', icon: 'folder-outline' },
  { label: '服务', path: '/services', icon: 'grid-outline' },
];

export const UTILITY_DESTINATIONS = [
  { label: '消息', path: '/messages', icon: 'chatbubble-outline' },
  { label: '待处理', path: '/attention', icon: 'checkbox-outline' },
] as const;

/** @deprecated V7 uses one five-item bottom navigation. */
export const TOP_DESTINATIONS = PRIMARY_DESTINATIONS;
/** @deprecated Messages and todo are header utilities in V7. */
export const BOTTOM_ACTIONS = UTILITY_DESTINATIONS;

/** 顶层入口选中态：首页严格匹配，其余入口匹配自身及子路由。 */
export function isSelected(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}
