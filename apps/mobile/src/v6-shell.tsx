import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { workspaceColors as colors, radius, spacing, typography } from './design';
import { isSelected, PRIMARY_DESTINATIONS } from './v6-navigation';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Profile { displayName: string; status: string }
interface TodayAttentionSummary { pendingApprovals: unknown[]; connectionIssues: unknown[]; alerts: unknown[] }

const DRAWER_ITEMS: readonly { icon: IconName; label: string; path: string }[] = [
  { icon: 'person-outline', label: '账号与登录', path: '/security-center' },
  { icon: 'settings-outline', label: '应用设置', path: '/feature-placeholder?feature=preferences' },
  { icon: 'extension-puzzle-outline', label: '资源管理', path: '/private' },
  { icon: 'shield-checkmark-outline', label: '数据与隐私', path: '/feature-placeholder?feature=personal-privacy' },
  { icon: 'help-circle-outline', label: '帮助与反馈', path: '/feature-placeholder?feature=help' },
  { icon: 'information-circle-outline', label: '关于懒人装甲', path: '/feature-placeholder?feature=about' },
];

/** 顶部导航：仅在首页显示（头像+名字 ｜ 搜索+设置），其他页面不占空间。参考 Today 聊天页顶部。 */
export function TopWorkspaceNav() {
  const pathname = usePathname();
  const token = useAuthStore((store) => store.token);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token), staleTime: 60_000 });
  const unread = useQuery({ queryKey: ['notifications-unread', token], queryFn: () => api<{ count: number }>('/notifications/unread-count', token), enabled: Boolean(token), staleTime: 30_000 });
  const attention = useQuery({ queryKey: ['global-action-today', token], queryFn: () => api<TodayAttentionSummary>('/today', token), enabled: Boolean(token), staleTime: 30_000 });
  const todoCount = (attention.data?.pendingApprovals.length ?? 0) + (attention.data?.connectionIssues.length ?? 0) + (attention.data?.alerts.length ?? 0);
  const name = profile.data?.displayName ?? (token ? '我的账号' : '未登录');
  const home = pathname === '/';
  const navigateFromDrawer = (path: string) => { setDrawerOpen(false); router.push(path as never); };

  if (!home) return null;

  return <>
    <SafeAreaView pointerEvents="box-none" edges={['top']} style={styles.floatingLayer}>
      <View pointerEvents="box-none" style={styles.floatingRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="打开我的" onPress={() => setDrawerOpen(true)} style={({ pressed }) => [styles.identity, pressed && styles.pressed]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></View>
          <Text numberOfLines={1} style={styles.identityName}>{name}</Text><Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.floatingUtilities}>
          <IconButton label="消息" icon="notifications-outline" badge={unread.data?.count ?? 0} onPress={() => router.replace('/messages' as never)} />
          <IconButton label="待办" icon="checkbox-outline" badge={todoCount} onPress={() => router.replace('/todo' as never)} />
        </View>
      </View>
    </SafeAreaView>
    <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
      <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)}><Pressable style={styles.drawer} onPress={(event) => event.stopPropagation()}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawerSafe}>
          <View style={styles.drawerHeader}><View style={styles.drawerAvatar}><Text style={styles.drawerAvatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></View><View style={styles.drawerIdentity}><Text style={styles.drawerName}>{name}</Text><Text style={styles.drawerMotto}>{profile.data?.status || '从复杂中来，游刃有余'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={() => setDrawerOpen(false)} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable></View>
          <View style={styles.drawerList}>{DRAWER_ITEMS.map((item) => <Pressable key={item.label} accessibilityRole="button" onPress={() => navigateFromDrawer(item.path)} style={({ pressed }) => [styles.drawerRow, pressed && styles.rowPressed]}><Ionicons name={item.icon} size={21} color={colors.text} /><Text style={styles.drawerLabel}>{item.label}</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</View>
        </SafeAreaView>
      </Pressable></Pressable>
    </Modal>
  </>;
}

export function GlobalActionBar() {
  const pathname = usePathname();
  return <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}><View style={styles.bottomBar}>{PRIMARY_DESTINATIONS.map((item) => {
    const selected = isSelected(pathname, item.path);
    const icon = (selected ? item.icon.replace('-outline', '') : item.icon) as IconName;
    return <Pressable key={item.path} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => router.replace(item.path as never)} style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}><Ionicons name={icon} size={21} color={selected ? colors.text : colors.textSecondary} /><Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text></Pressable>;
  })}</View></SafeAreaView>;
}

/** 底部 AI 输入条（Today 式）：attach + 占位 + 语音，点击跳问一问。 */
export function AssistantInputBar() {
  return <View style={styles.assistantBar}><Pressable accessibilityRole="button" accessibilityLabel="问点什么" onPress={() => router.push('/search-ai' as never)} style={({ pressed }) => [styles.assistantPill, pressed && styles.pressed]}>
    <Ionicons name="add-circle-outline" size={22} color={colors.textSecondary} />
    <Text style={styles.assistantPlaceholder}>让懒人装甲帮你规划、研究或创作</Text>
    <Ionicons name="mic-outline" size={22} color={colors.text} />
  </Pressable></View>;
}

function IconButton({ label, icon, badge = 0, onPress }: { label: string; icon: IconName; badge?: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={badge > 0 ? `${label}，${badge} 项` : label} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Ionicons name={icon} size={22} color={colors.text} />{badge > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  floatingLayer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, backgroundColor: 'transparent' },
  floatingRow: { width: '100%', minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  floatingUtilities: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 6, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.72)' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: 6, paddingRight: 14, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.65)' },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  avatarText: { color: colors.brand, fontSize: 15, fontWeight: '700' },
  identityName: { ...typography.bodyStrong, color: colors.text, maxWidth: 160 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.danger },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  assistantBar: { backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  assistantPill: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  assistantPlaceholder: { flex: 1, ...typography.caption, color: colors.textMuted },
  bottomSafeArea: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bottomBar: { height: 55, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  navItem: { flex: 1, height: 55, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navLabel: { fontSize: 10, lineHeight: 13, color: colors.textSecondary },
  navLabelSelected: { color: colors.text, fontWeight: '700' },
  drawerBackdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  drawer: { width: '78%', maxWidth: 360, height: '100%', backgroundColor: colors.surface },
  drawerSafe: { flex: 1 },
  drawerHeader: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  drawerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  drawerAvatarText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  drawerIdentity: { flex: 1, minWidth: 0 },
  drawerName: { ...typography.bodyStrong, color: colors.text },
  drawerMotto: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  drawerList: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  drawerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  drawerLabel: { ...typography.body, color: colors.text, flex: 1 },
  pressed: { opacity: 0.62 },
  rowPressed: { backgroundColor: colors.pressed },
});
