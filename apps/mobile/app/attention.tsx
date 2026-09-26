import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import {
  filterTodos,
  TODO_FILTERS,
  todoFilterLabel,
  todoIcon,
  todoRoute,
  todoSource,
  todoStatusLabel,
  todoTone,
  todoTypeLabel,
  type TodoFilter,
  type TodoItem,
  type TodoTab,
} from '../src/todo-presenter';
import { EmptyState, MessageRow, Surface, WorkspaceHeader, workspaceColors as colors, radius, spacing, typography } from '../src/design';

const MAIN_TABS: Array<{ key: TodoTab; label: string }> = [
  { key: 'OPEN', label: '待处理' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'ALL', label: '全部' },
];

export default function AttentionPage() {
  const pathname = usePathname();
  const token = useAuthStore((store) => store.token);
  const [tab, setTab] = useState<TodoTab>('OPEN');
  const [filter, setFilter] = useState<TodoFilter>('ALL');
  const todos = useQuery({
    queryKey: ['todos', token],
    queryFn: () => api<TodoItem[]>('/todos', token),
    enabled: Boolean(token),
    refetchInterval: 10_000,
  });
  const items = todos.data ?? [];
  const visible = useMemo(
    () => filterTodos(items, tab, tab === 'OPEN' ? filter : 'ALL'),
    [items, tab, filter],
  );
  const openCount = items.filter((item) => item.status === 'OPEN').length;
  const completedCount = items.filter((item) => item.status === 'COMPLETED').length;
  const loading = todos.isLoading;
  const error = todos.isError;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={todos.isFetching} onRefresh={() => todos.refetch()} /> : undefined}
      >
        <WorkspaceHeader title="待办" subtitle="审批、确认、异常和结果核实统一收在这里" onBack={pathname === '/todo' ? undefined : () => router.back()} />

        {!token ? (
          <Surface style={styles.stateSurface}><EmptyState icon="notifications-outline" title="登录后查看需要你处理的事" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface>
        ) : null}

        {token ? <View style={styles.tabs}>
          {MAIN_TABS.map((item) => <Chip key={item.key} label={item.label} count={item.key === 'OPEN' ? openCount : item.key === 'COMPLETED' ? completedCount : items.length} active={tab === item.key} onPress={() => { setTab(item.key); setFilter('ALL'); }} />)}
        </View> : null}

        {token && tab === 'OPEN' ? <View style={styles.filters}>
          {TODO_FILTERS.map((item) => <Chip key={item} label={todoFilterLabel(item)} active={filter === item} onPress={() => setFilter(item)} />)}
        </View> : null}

        {token && loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在核对需要你处理的事…</Text></View>
        ) : null}

        {token && !loading && error ? (
          <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="暂时没有加载出来" description="请稍后再试，不会影响已有计划。" action={{ label: '重新加载', onPress: () => todos.refetch() }} /></Surface>
        ) : null}

        {token && !loading && !error && visible.length === 0 ? (
          <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name="checkmark" size={18} color={colors.success} /></View><View style={styles.emptyCopy}><Text style={styles.emptyTitle}>{tab === 'OPEN' ? '没有需要你处理的事' : '这里还没有记录'}</Text><Text style={styles.emptyDescription}>计划会继续运行，只有真正需要你决定或处理的事才会出现。</Text></View></View>
        ) : null}

        {token && !loading && !error && visible.length > 0 ? (
          <View style={styles.group}>
            {visible.map((item, index) => (
              <MessageRow
                key={item.id}
                icon={todoIcon(item.type)}
                title={todoSource(item)}
                description={`${item.summary} · ${tab === 'OPEN' ? todoTypeLabel(item.type) : todoStatusLabel(item.status)}`}
                meta={formatTodoTime(item.createdAt)}
                tone={item.status === 'COMPLETED' ? 'brand' : todoTone(item.type)}
                last={index === visible.length - 1}
                onPress={() => { const route = todoRoute(item); if (route) router.push(route as never); }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, count, active, onPress }: { label: string; count?: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {typeof count === 'number' && count > 0 ? <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count > 99 ? '99+' : String(count)}</Text> : null}
    </Pressable>
  );
}

function formatTodoTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  stateSurface: { marginTop: spacing.xl },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipPressed: { opacity: 0.75 },
  chipText: { ...typography.caption, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  chipCount: { fontSize: 10, lineHeight: 14, fontWeight: '800', color: colors.textMuted },
  chipCountActive: { color: '#FFFFFF' },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  emptyState: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  emptyCopy: { flex: 1 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  group: { marginTop: spacing.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
});
