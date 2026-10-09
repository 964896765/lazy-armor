import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { workspaceColors as colors, spacing, typography } from './design';
import { isSelected, PRIMARY_DESTINATIONS } from './v6-navigation';

type IconName = ComponentProps<typeof Ionicons>['name'];
const PAGE_TITLES: Readonly<Record<string, string>> = {
  '/plans': '计划', '/chat': '会话', '/resources': '资源', '/services': '服务', '/messages': '消息', '/attention': '待处理',
};

export function TopWorkspaceNav() {
  const pathname=usePathname();
  return <SafeAreaView edges={['top']} style={styles.topSafeArea}><View style={styles.topBar}>
    {pathname==='/schedule'?<Pressable accessibilityRole="button" accessibilityLabel="我的" onPress={()=>router.push('/profile' as never)} style={styles.avatar}><Text style={styles.avatarText}>我</Text></Pressable>:null}
    <Text style={styles.topTitle}>{PAGE_TITLES[pathname]??'懒人装甲'}</Text>
    <HeaderButton label="搜索日程" icon="search-outline" badge={0} onPress={()=>router.push('/schedule-search' as never)}/>
  </View></SafeAreaView>;
}
export function GlobalActionBar() {
  const pathname = usePathname();
  return <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}><View style={styles.bottomBar}>{PRIMARY_DESTINATIONS.map((item) => {
    const selected = isSelected(pathname, item.path);
    const icon = (selected ? item.icon.replace('-outline', '') : item.icon) as IconName;
    return <Pressable key={item.path} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => router.replace(item.path as never)} style={({ pressed }) => [styles.navItem, selected && styles.navItemSelected, pressed && styles.pressed]}><Ionicons name={icon} size={20} color={selected ? colors.primary : colors.textSecondary} /><Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text></Pressable>;
  })}</View></SafeAreaView>;
}

function HeaderButton({ label, icon, badge, onPress }: { label: string; icon: IconName; badge: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={badge > 0 ? `${label}，${badge} 项` : label} onPress={onPress} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}><Ionicons name={icon} size={21} color={colors.text} />{badge > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  topSafeArea: { backgroundColor: colors.surface }, topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8E6' }, avatarText: { color: colors.text, fontSize: 13, fontWeight: '700' }, topTitle: { ...typography.navigationTitle, color: colors.text, fontWeight: '700', flex: 1 }, topSpacer: { flex: 1 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E34D59' }, badgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  bottomSafeArea: { backgroundColor: 'rgba(248,250,252,0.72)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE5EE' }, bottomBar: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(248,250,252,0.72)' }, navItem: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 15 }, navItemSelected: { backgroundColor: '#E5EDF5' }, navLabel: { fontSize: 11, lineHeight: 16, color: '#667386' }, navLabelSelected: { color: colors.primary, fontWeight: '600' },
  drawerBackdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' }, drawer: { width: '78%', maxWidth: 360, height: '100%', backgroundColor: colors.surface }, drawerSafe: { flex: 1 }, drawerHeader: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, drawerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8E6' }, drawerAvatarText: { color: colors.text, fontSize: 18, fontWeight: '700' }, drawerIdentity: { flex: 1, minWidth: 0 }, drawerName: { ...typography.bodyStrong, color: colors.text }, drawerMotto: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, drawerList: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, drawerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, drawerLabel: { ...typography.body, color: colors.text, flex: 1 }, pressed: { opacity: 0.62 }, rowPressed: { backgroundColor: colors.pressed },
});
