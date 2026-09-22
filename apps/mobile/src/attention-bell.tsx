import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { attentionNeedsCount, type AttentionReconciliation, type AttentionToday } from './attention-presenter';
import { useAuthStore } from './auth-store';
import { colors, radius, spacing, typography } from './design';

/** Top-right bell that opens the unified Attention workspace and shows a red-dot count. */
export function AttentionBell() {
  const token = useAuthStore((store) => store.token);
  const today = useQuery({ queryKey: ['attention-bell-today', token], queryFn: () => api<AttentionToday>('/today', token), enabled: Boolean(token), staleTime: 30_000 });
  const reconciliation = useQuery({ queryKey: ['attention-bell-reconciliation', token], queryFn: () => api<AttentionReconciliation[]>('/reconciliation-cases', token), enabled: Boolean(token), staleTime: 30_000 });
  const count = attentionNeedsCount(today.data, reconciliation.data ?? []);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="需要你处理的事" onPress={() => router.push('/attention' as never)} style={({ pressed }) => [styles.bell, pressed && styles.pressed]}>
      <Ionicons name="notifications-outline" size={22} color={colors.text} />
      {count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pressed: { backgroundColor: colors.pressed },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.label, fontSize: 10, lineHeight: 12, color: '#FFFFFF' },
});
