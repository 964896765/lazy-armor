import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, WorkspaceHeader, WorkspaceSection, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { executionAttentionLabel, executionListState, executionNeedsAttention, executionRecordCategory, executionStatusLabel } from '../../src/execution-presenter';
import { consumerOutcomeLabel } from '../../src/outcome-presenter';

interface ExecutionRecord {
  id: string;
  planName: string;
  status: string;
  resultSummary: string | null;
  resultState: string | null;
  outcome: { outcome: 'SUCCESS' | 'FAILED' | 'PENDING_CONFIRMATION' | 'OUTCOME_UNKNOWN' | null } | null;
  createdAt: string;
}

type RecordFilter = 'all' | 'success' | 'processing' | 'failed' | 'exception' | 'outcome';
const FILTERS: Array<{ key: RecordFilter; label: string; icon: 'list' | 'checkmark-circle' | 'time-outline' | 'close-circle' | 'warning' | 'help-circle' }> = [
  { key: 'all', label: '全部', icon: 'list' },
  { key: 'success', label: '成功', icon: 'checkmark-circle' },
  { key: 'processing', label: '处理中', icon: 'time-outline' },
  { key: 'failed', label: '失败', icon: 'close-circle' },
  { key: 'exception', label: '异常', icon: 'warning' },
  { key: 'outcome', label: '结果待确认', icon: 'help-circle' },
];

export default function Records() {
  const token = useAuthStore((store) => store.token);
  const [filter, setFilter] = useState<RecordFilter>('all');
  const executions = useQuery({ queryKey: ['executions', token], queryFn: () => api<ExecutionRecord[]>('/executions', token), enabled: Boolean(token) });
  const state = executionListState(executions.isLoading, executions.isError, executions.data?.length ?? 0);
  const shown = useMemo(() => (executions.data ?? []).filter((item) => filter === 'all' || executionRecordCategory(item.status, item.resultState) === filter), [executions.data, filter]);
  const groups = groupByDay(shown);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={executions.isFetching} onRefresh={() => executions.refetch()} /> : undefined}>
        <WorkspaceHeader title="最近做了什么" subtitle="计划触发、审批、执行和结果都记录在这里" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{FILTERS.map((item) => <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filter, filter === item.key && styles.filterSelected]}><Ionicons name={item.icon} size={14} color={filter === item.key ? colors.primary : item.key === 'failed' ? colors.danger : item.key === 'exception' || item.key === 'outcome' ? colors.warning : colors.textSecondary} /><Text style={[styles.filterText, filter === item.key && styles.filterTextSelected]}>{item.label}</Text></Pressable>)}</ScrollView>
        {filter === 'outcome' ? <Pressable accessibilityRole="button" onPress={() => router.push('/reconciliation' as never)} style={styles.reconciliationLink}><Text style={styles.reconciliationLinkText}>打开结果回查中心</Text><Ionicons name="arrow-forward" size={15} color={colors.primary} /></Pressable> : null}

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="time-outline" title="登录后查看完成记录" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : null}
        {state === 'loading' ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在同步记录…</Text></View> : null}
        {state === 'error' ? <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="记录暂时没有加载出来" description="请稍后再试。" action={{ label: '重新加载', onPress: () => executions.refetch() }} /></Surface> : null}
        {state === 'empty' ? (
          <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name="checkmark" size={17} color={colors.success} /></View><View style={styles.emptyCopy}><Text style={styles.emptyTitle}>还没有替你做过什么</Text><Text style={styles.emptyDescription}>计划运行后的真实结果会出现在这里</Text></View><Pressable accessibilityRole="button" onPress={() => router.push('/create')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><Text style={styles.emptyActionText}>去安排</Text></Pressable></View>
        ) : null}

        {state === 'ready' ? groups.map(([label, records]) => (
          <WorkspaceSection key={label} title={label} count={records.length}>
            <View style={styles.timelineGroup}>
              {records.map((item, index) => {
                const category = executionRecordCategory(item.status, item.resultState);
                const needsAttention = category === 'outcome' || executionNeedsAttention(item.status);
                const statusText = item.outcome ? consumerOutcomeLabel(item.outcome.outcome) : (category === 'outcome' ? '结果待确认' : executionAttentionLabel(item.status));
                return (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/executions/${item.id}` as never)} style={({ pressed }) => [styles.timelineRow, index < records.length - 1 && styles.divider, pressed && styles.pressedRow]}>
                    <View style={styles.markerColumn}><View style={[styles.marker, category === 'success' ? styles.markerSuccess : category === 'processing' ? styles.markerProcessing : styles.markerWarning]}><Ionicons name={category === 'success' ? 'checkmark' : category === 'processing' ? 'time' : category === 'outcome' ? 'help-circle' : 'warning'} size={12} color={category === 'success' ? '#16834A' : category === 'processing' ? colors.primary : '#B54708'} /></View></View>
                    <View style={styles.recordCopy}>
                      <View style={styles.recordHeader}><Text numberOfLines={1} style={styles.recordTitle}>{item.planName}</Text><Text style={styles.time}>{formatTime(item.createdAt)}</Text></View>
                      <Text numberOfLines={2} style={styles.summary}>{item.resultSummary ?? executionStatusLabel(item.status)}</Text>
                      <Text style={[styles.status, needsAttention && styles.statusWarning]}>{statusText}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </WorkspaceSection>
        )) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function groupByDay(records: ExecutionRecord[]): Array<[string, ExecutionRecord[]]> {
  const groups = new Map<string, ExecutionRecord[]>();
  for (const record of records) {
    const label = dayLabel(record.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), record]);
  }
  return [...groups.entries()];
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  reconciliationLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  reconciliationLinkText: { ...typography.label, color: colors.primary },
  filters: { minHeight: 42, alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, padding: 3, paddingRight: spacing.md, borderRadius: radius.md, backgroundColor: '#F3F6F8' },
  filter: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, borderRadius: radius.sm },
  filterSelected: { backgroundColor: colors.surface },
  filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  filterTextSelected: { color: colors.primary, fontWeight: '800' },
  stateSurface: { marginTop: spacing.xl },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  emptyState: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  emptyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8F7EF', alignItems: 'center', justifyContent: 'center' },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  emptyAction: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  timelineGroup: { backgroundColor: colors.surface, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  timelineRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  pressedRow: { backgroundColor: '#F7F8FA' },
  markerColumn: { width: 30, alignItems: 'center' },
  marker: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  markerSuccess: { backgroundColor: '#E8F7EF' },
  markerProcessing: { backgroundColor: colors.accentSoft },
  markerWarning: { backgroundColor: '#FFF4E5' },
  recordCopy: { flex: 1, minWidth: 0 },
  recordHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recordTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  time: { ...typography.caption, color: colors.textMuted },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  status: { color: '#16834A', fontSize: 10, lineHeight: 15, marginTop: 2 },
  statusWarning: { color: '#B54708' },
});
