import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';
import { executionAttentionLabel, executionListState, executionNeedsAttention, executionStatusLabel } from '../../src/execution-presenter';

interface ExecutionRecord {
  id: string;
  planName: string;
  status: string;
  resultSummary: string | null;
  createdAt: string;
}

export default function Records() {
  const token = useAuthStore((store) => store.token);
  const executions = useQuery({ queryKey: ['executions', token], queryFn: () => api<ExecutionRecord[]>('/executions', token), enabled: Boolean(token) });
  const state = executionListState(executions.isLoading, executions.isError, executions.data?.length ?? 0);
  const groups = groupByDay(executions.data ?? []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor="#5865F2" refreshing={executions.isFetching} onRefresh={() => executions.refetch()} /> : undefined}>
        <WorkspaceHeader title="记录" subtitle="懒人装甲帮你做过的事" />

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="🕰️" title="登录后查看完成记录" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : null}
        {state === 'loading' ? <View style={styles.loading}><ActivityIndicator color="#5865F2" /><Text style={styles.loadingText}>正在同步记录…</Text></View> : null}
        {state === 'error' ? <Surface style={styles.stateSurface}><EmptyState icon="☁️" title="记录暂时没有加载出来" description="请稍后再试。" action={{ label: '重新加载', onPress: () => executions.refetch() }} /></Surface> : null}
        {state === 'empty' ? (
          <View style={styles.emptyState}><View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✓</Text></View><View style={styles.emptyCopy}><Text style={styles.emptyTitle}>还没有完成记录</Text><Text style={styles.emptyDescription}>真实结果会出现在这里</Text></View><Pressable accessibilityRole="button" onPress={() => router.push('/create')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><Text style={styles.emptyActionText}>去安排</Text></Pressable></View>
        ) : null}

        {state === 'ready' ? groups.map(([label, records]) => (
          <WorkspaceSection key={label} title={label} count={records.length}>
            <View style={styles.timelineGroup}>
              {records.map((item, index) => {
                const needsAttention = executionNeedsAttention(item.status);
                return (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/executions/${item.id}` as never)} style={({ pressed }) => [styles.timelineRow, index < records.length - 1 && styles.divider, pressed && styles.pressedRow]}>
                    <View style={styles.markerColumn}><View style={[styles.marker, needsAttention ? styles.markerWarning : styles.markerSuccess]}><Text style={[styles.markerText, needsAttention && styles.markerTextWarning]}>{needsAttention ? '!' : '✓'}</Text></View></View>
                    <View style={styles.recordCopy}>
                      <View style={styles.recordHeader}><Text numberOfLines={1} style={styles.recordTitle}>{item.planName}</Text><Text style={styles.time}>{formatTime(item.createdAt)}</Text></View>
                      <Text numberOfLines={2} style={styles.summary}>{item.resultSummary ?? executionStatusLabel(item.status)}</Text>
                      <Text style={[styles.status, needsAttention && styles.statusWarning]}>{executionAttentionLabel(item.status)}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
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
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  stateSurface: { marginTop: spacing.xl },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  emptyState: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  emptyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8F7EF', alignItems: 'center', justifyContent: 'center' },
  emptyIconText: { color: '#23A559', fontSize: 15, fontWeight: '900' },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  emptyAction: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: '#5865F2', alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  timelineGroup: { backgroundColor: '#FFFFFF' },
  timelineRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  pressedRow: { backgroundColor: '#F7F8FA' },
  markerColumn: { width: 30, alignItems: 'center' },
  marker: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  markerSuccess: { backgroundColor: '#E8F7EF' },
  markerWarning: { backgroundColor: '#FFF4E5' },
  markerText: { color: '#16834A', fontWeight: '900', fontSize: 11 },
  markerTextWarning: { color: '#B54708' },
  recordCopy: { flex: 1, minWidth: 0 },
  recordHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recordTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  time: { ...typography.caption, color: colors.textMuted },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  status: { color: '#16834A', fontSize: 10, lineHeight: 15, marginTop: 2 },
  statusWarning: { color: '#B54708' },
  chevron: { color: '#98A2B3', fontSize: 24, fontWeight: '300' },
});
