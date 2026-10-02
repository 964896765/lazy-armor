import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { workspaceColors as colors, spacing, typography } from './design';
import { isSelected, PRIMARY_DESTINATIONS } from './v6-navigation';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Profile { displayName: string; status: string }
interface AttentionItem { status: 'OPEN' | 'COMPLETED' }

const PAGE_TITLES: Readonly<Record<string, string>> = {
  '/plans': '计划', '/chat': '聊天', '/private': '资源', '/services': '服务', '/messages': '消息', '/attention': '待处理',
};

const DRAWER_ITEMS: readonly { icon: IconName; label: string; path: string }[] = [
  { icon: 'person-outline', label: '账号与登录', path: '/security-center' },
  { icon: 'settings-outline', label: '应用设置', path: '/feature-placeholder?feature=preferences' },
  { icon: 'extension-puzzle-outline', label: '资源管理', path: '/private' },
  { icon: 'shield-checkmark-outline', label: '数据与隐私', path: '/feature-placeholder?feature=personal-privacy' },
  { icon: 'help-circle-outline', label: '帮助与反馈', path: '/feature-placeholder?feature=help' },
  { icon: 'information-circle-outline', label: '关于懒人装甲', path: '/feature-placeholder?feature=about' },
];

export function TopWorkspaceNav() {
  const pathname = usePathname();
  const token = useAuthStore((store) => store.token);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token), staleTime: 60_000 });
  const unread = useQuery({ queryKey: ['notifications-unread', token], queryFn: () => api<{ count: number }>('/notifications/unread-count', token), enabled: Boolean(token), staleTime: 30_000 });
  const attention = useQuery({ queryKey: ['global-attention', token], queryFn: () => api<AttentionItem[]>('/attention', token), enabled: Boolean(token), staleTime: 30_000 });
  const todoCount = attention.data?.filter((item) => item.status === 'OPEN').length ?? 0;
  const name = profile.data?.displayName ?? (token ? '我的账号' : '未登录');
  const title = PAGE_TITLES[pathname];
  const navigateFromDrawer = (path: string) => { setDrawerOpen(false); router.push(path as never); };

  return <>
    <SafeAreaView edges={['top']} style={styles.topSafeArea}><View style={styles.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="打开我的" onPress={() => setDrawerOpen(true)} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></Pressable>
      {title ? <Text style={styles.topTitle}>{title}</Text> : <View style={styles.topSpacer} />}
      <HeaderButton label="消息" icon="notifications-outline" badge={unread.data?.count ?? 0} onPress={() => router.replace('/messages' as never)} />
      <HeaderButton label="待处理" icon="checkbox-outline" badge={todoCount} onPress={() => router.push('/attention' as never)} />
    </View></SafeAreaView>
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
    return <Pressable key={item.path} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => router.replace(item.path as never)} style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}><Ionicons name={icon} size={21} color={selected ? colors.primary : colors.textSecondary} /><Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text></Pressable>;
  })}</View></SafeAreaView>;
}

function HeaderButton({ label, icon, badge, onPress }: { label: string; icon: IconName; badge: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={badge > 0 ? `${label}，${badge} 项` : label} onPress={onPress} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}><Ionicons name={icon} size={21} color={colors.text} />{badge > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  topSafeArea: { backgroundColor: colors.surface }, topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8E6' }, avatarText: { color: colors.text, fontSize: 13, fontWeight: '700' }, topTitle: { ...typography.navigationTitle, color: colors.text, fontWeight: '700', flex: 1 }, topSpacer: { flex: 1 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E34D59' }, badgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  bottomSafeArea: { backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE5EE' }, bottomBar: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: '#FFFFFF' }, navItem: { flex: 1, height: 54, alignItems: 'center', justifyContent: 'center', gap: 1 }, navLabel: { fontSize: 11, lineHeight: 16, color: '#667386' }, navLabelSelected: { color: colors.primary, fontWeight: '600' },
  drawerBackdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' }, drawer: { width: '78%', maxWidth: 360, height: '100%', backgroundColor: colors.surface }, drawerSafe: { flex: 1 }, drawerHeader: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, drawerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8E6' }, drawerAvatarText: { color: colors.text, fontSize: 18, fontWeight: '700' }, drawerIdentity: { flex: 1, minWidth: 0 }, drawerName: { ...typography.bodyStrong, color: colors.text }, drawerMotto: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, drawerList: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, drawerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, drawerLabel: { ...typography.body, color: colors.text, flex: 1 }, pressed: { opacity: 0.62 }, rowPressed: { backgroundColor: colors.pressed },
});
