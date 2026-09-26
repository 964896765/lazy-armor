import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { notificationDeepLink } from '../../src/consumer-error-presenter';
import { EmptyState, workspaceColors as colors, radius, spacing, typography } from '../../src/design';

interface NotificationRow { id: string; title: string; body: string; status: string; eventType: string; createdAt: string; executionId?: string | null; approvalRequestId?: string | null; connectionId?: string | null }

export default function MessagesPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const messages = useQuery({ queryKey: ['notifications', token], queryFn: () => api<NotificationRow[]>('/notifications', token), enabled: Boolean(token) });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, token, { method: 'POST' }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['notifications', token] }), client.invalidateQueries({ queryKey: ['notifications-unread', token] })]); },
  });
  function open(item: NotificationRow) {
    if (item.status === 'unread') markRead.mutate(item.id);
    const route = notificationDeepLink({ eventType: item.eventType, executionId: item.executionId, approvalRequestId: item.approvalRequestId, connectionId: item.connectionId, reconciliationCaseId: null });
    if (route) router.push(route as never);
  }
  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl refreshing={messages.isFetching} onRefresh={() => messages.refetch()} tintColor={colors.primary} /> : undefined}>
    <Text style={styles.title}>消息</Text><Text style={styles.subtitle}>事件告知来自服务端通知；已读不会完成待办或改变审批状态。</Text>
    {!token ? <EmptyState icon="notifications-outline" title="登录后查看消息" /> : null}
    {messages.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.subtitle}>正在读取消息…</Text></View> : null}
    {messages.isError ? <EmptyState icon="cloud-offline-outline" title="消息暂时不可用" action={{ label: '重新加载', onPress: () => messages.refetch() }} /> : null}
    {messages.data?.length === 0 ? <EmptyState icon="notifications-off-outline" title="还没有消息" description="计划和系统产生真实事件后会显示在这里。" /> : null}
    <View style={styles.list}>{messages.data?.map((item, index) => <Pressable key={item.id} accessibilityRole="button" onPress={() => open(item)} style={({ pressed }) => [styles.row, index < (messages.data?.length ?? 0) - 1 && styles.divider, pressed && styles.pressed]}><View style={[styles.dot, item.status !== 'unread' && styles.dotRead]} /><View style={styles.copy}><View style={styles.rowTitleLine}><Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text><Text style={styles.time}>{formatTime(item.createdAt)}</Text></View><Text numberOfLines={2} style={styles.body}>{item.body}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}</View>
  </ScrollView></SafeAreaView>;
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, paddingBottom: spacing.xxl }, title: { ...typography.title, color: colors.text, marginTop: spacing.md }, subtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs }, loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, list: { marginTop: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, pressed: { backgroundColor: colors.pressed }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotRead: { backgroundColor: '#CBC8C1' }, copy: { flex: 1, minWidth: 0 }, rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, time: { fontSize: 9, color: colors.textMuted }, body: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 3 } });
