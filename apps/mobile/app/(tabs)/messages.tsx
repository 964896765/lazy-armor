import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { notificationDeepLink } from '../../src/consumer-error-presenter';
import { formatUnreadCount, messageChannel, messageChannelLabel, type MessageChannelFilter } from '../../src/message-presenter';
import { EmptyState, workspaceColors as colors, radius, spacing, typography } from '../../src/design';

interface NotificationRow { id: string; title: string; body: string; status: string; eventType: string; createdAt: string; executionId?: string | null; approvalRequestId?: string | null; connectionId?: string | null }

const CHANNELS: Array<{ key: MessageChannelFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'plan', label: '计划动态' },
  { key: 'system', label: '系统通知' },
];

export default function MessagesPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [channel, setChannel] = useState<MessageChannelFilter>('all');
  const messages = useQuery({ queryKey: ['notifications', token], queryFn: () => api<NotificationRow[]>('/notifications', token), enabled: Boolean(token) });
  const unread = useQuery({ queryKey: ['notifications-unread', token], queryFn: () => api<{ count: number }>('/notifications/unread-count', token), enabled: Boolean(token) });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, token, { method: 'POST' }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['notifications', token] }), client.invalidateQueries({ queryKey: ['notifications-unread', token] })]); },
  });
  const rows = useMemo(() => {
    const all = messages.data ?? [];
    return channel === 'all' ? all : all.filter((item) => messageChannel(item.eventType) === channel);
  }, [messages.data, channel]);
  function open(item: NotificationRow) {
    if (item.status === 'unread') markRead.mutate(item.id);
    const route = notificationDeepLink({ eventType: item.eventType, executionId: item.executionId, approvalRequestId: item.approvalRequestId, connectionId: item.connectionId, reconciliationCaseId: null });
    if (route) router.push(route as never);
  }
  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl refreshing={messages.isFetching} onRefresh={() => { messages.refetch(); unread.refetch(); }} tintColor={colors.primary} /> : undefined}>
    <View style={styles.header}><Text style={styles.title}>消息</Text>{unread.data && unread.data.count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{formatUnreadCount(unread.data.count)}</Text></View> : null}</View>
    <Text style={styles.subtitle}>事件告知来自服务端通知；已读不会完成待办或改变审批状态。</Text>
    {!token ? <EmptyState icon="notifications-outline" title="登录后查看消息" /> : null}
    {token ? <View style={styles.channels}>{CHANNELS.map((item) => <Chip key={item.key} label={item.label} active={channel === item.key} onPress={() => setChannel(item.key)} />)}</View> : null}
    {messages.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.subtitle}>正在读取消息…</Text></View> : null}
    {messages.isError ? <EmptyState icon="cloud-offline-outline" title="消息暂时不可用" action={{ label: '重新加载', onPress: () => messages.refetch() }} /> : null}
    {!messages.isLoading && !messages.isError && messages.data && rows.length === 0 ? <EmptyState icon="notifications-off-outline" title="还没有消息" description="计划和系统产生真实事件后会显示在这里。" /> : null}
    <View style={styles.list}>{rows.map((item, index) => <Pressable key={item.id} accessibilityRole="button" onPress={() => open(item)} style={({ pressed }) => [styles.row, index < rows.length - 1 && styles.divider, pressed && styles.pressed]}><View style={[styles.dot, item.status !== 'unread' && styles.dotRead]} /><View style={styles.copy}><View style={styles.rowTitleLine}><Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text><Text style={styles.channelTag}>{messageChannelLabel(messageChannel(item.eventType))}</Text><Text style={styles.time}>{formatTime(item.createdAt)}</Text></View><Text numberOfLines={2} style={styles.body}>{item.body}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}</View>
  </ScrollView></SafeAreaView>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, paddingBottom: spacing.xxl }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }, title: { ...typography.title, color: colors.text }, badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#FFFFFF', fontSize: 11, lineHeight: 13, fontWeight: '800' }, subtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs }, channels: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }, chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipPressed: { opacity: 0.75 }, chipText: { ...typography.caption, fontWeight: '600', color: colors.textSecondary }, chipTextActive: { color: '#FFFFFF' }, loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, list: { marginTop: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, pressed: { backgroundColor: colors.pressed }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotRead: { backgroundColor: '#CBC8C1' }, copy: { flex: 1, minWidth: 0 }, rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, channelTag: { fontSize: 9, color: colors.textMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.accentSoft }, time: { fontSize: 9, color: colors.textMuted }, body: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 3 } });
