import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { workspaceColors as colors, radius, spacing, typography } from './design';
import { isSelected, TOP_DESTINATIONS } from './v6-navigation';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function TopWorkspaceNav() {
  const pathname = usePathname();
  const avatarSelected = pathname === '/me';
  return (
    <SafeAreaView edges={['top']} style={styles.topSafeArea}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="头像和个人设置"
          accessibilityState={{ selected: avatarSelected }}
          onPress={() => router.replace('/me' as never)}
          style={({ pressed }) => [styles.avatar, avatarSelected && styles.avatarSelected, pressed && styles.pressed]}
        >
          <Ionicons name="person-outline" size={20} color={avatarSelected ? '#FFFFFF' : colors.primary} />
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topDestinations}>
          {TOP_DESTINATIONS.map((item) => {
            const selected = isSelected(pathname, item.path);
            return (
              <Pressable
                key={item.path}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => router.replace(item.path as never)}
                style={({ pressed }) => [styles.topPill, selected && styles.topPillSelected, pressed && styles.pressed]}
              >
                <Ionicons name={item.icon as IconName} size={16} color={selected ? '#FFFFFF' : colors.textSecondary} />
                <Text style={[styles.topPillText, selected && styles.topPillTextSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

interface TodayAttentionSummary {
  pendingApprovals: unknown[];
  connectionIssues: unknown[];
  alerts: unknown[];
}

export function GlobalActionBar() {
  const pathname = usePathname();
  const token = useAuthStore((store) => store.token);
  const unread = useQuery({
    queryKey: ['notifications-unread', token],
    queryFn: () => api<{ count: number }>('/notifications/unread-count', token),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const attention = useQuery({
    queryKey: ['global-action-today', token],
    queryFn: () => api<TodayAttentionSummary>('/today', token),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const todoCount = (attention.data?.pendingApprovals.length ?? 0)
    + (attention.data?.connectionIssues.length ?? 0)
    + (attention.data?.alerts.length ?? 0);
  return (
    <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}>
      <View style={styles.bottomBar}>
        <BottomButton label="消息" icon="notifications-outline" badge={unread.data?.count ?? 0} selected={pathname === '/messages'} onPress={() => router.replace('/messages' as never)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索或问万事问"
          accessibilityState={{ selected: pathname === '/search-ai' }}
          onPress={() => router.replace('/search-ai' as never)}
          style={({ pressed }) => [styles.searchEntry, pathname === '/search-ai' && styles.searchEntrySelected, pressed && styles.pressed]}
        >
          <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          <Text numberOfLines={1} style={styles.searchEntryText}>搜索或问万事问</Text>
        </Pressable>
        <BottomButton label="待办" icon="checkbox-outline" badge={todoCount} selected={pathname === '/todo'} onPress={() => router.replace('/todo' as never)} />
      </View>
    </SafeAreaView>
  );
}

function BottomButton({ label, icon, badge, selected, onPress }: { label: string; icon: IconName; badge: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badge > 0 ? `${label}，${badge} 项` : label} accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.bottomButton, selected && styles.bottomButtonSelected, pressed && styles.pressed]}>
      <View>
        <Ionicons name={icon} size={21} color={selected ? colors.primary : colors.textSecondary} />
        {badge > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
      </View>
      <Text style={[styles.bottomLabel, selected && styles.bottomLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topSafeArea: { backgroundColor: colors.background },
  topBar: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  avatarSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  topDestinations: { alignItems: 'center', gap: spacing.sm, paddingRight: spacing.lg },
  topPill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#F0EFEB' },
  topPillSelected: { backgroundColor: colors.primary },
  topPillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  topPillTextSelected: { color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
  bottomSafeArea: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  bottomBar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  bottomButton: { width: 58, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.md },
  bottomButtonSelected: { backgroundColor: colors.successSoft },
  bottomLabel: { fontSize: 10, lineHeight: 14, color: colors.textSecondary, fontWeight: '700' },
  bottomLabelSelected: { color: colors.primary },
  searchEntry: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#F0EFEB', borderWidth: 1, borderColor: '#E4E1DA' },
  searchEntrySelected: { backgroundColor: colors.successSoft, borderColor: '#C9DDD3' },
  searchEntryText: { ...typography.caption, color: colors.text, fontWeight: '700', flexShrink: 1 },
  badge: { position: 'absolute', top: -7, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.warning },
  badgeText: { color: '#FFFFFF', fontSize: 8, lineHeight: 11, fontWeight: '800' },
});
