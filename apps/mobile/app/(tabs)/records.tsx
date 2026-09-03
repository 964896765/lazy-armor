import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';
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
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={executions.isFetching} onRefresh={() => executions.refetch()} /> : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>帮你做过的事</Text>
          <Text style={styles.subtitle}>每一次完成和提醒，都替你收在这里。</Text>
        </View>

        {!token ? <Surface><EmptyState icon="🕰️" title="登录后查看完成记录" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : null}
        {state === 'loading' ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理记录…</Text></View> : null}
        {state === 'error' ? <Surface><EmptyState icon="☁️" title="记录暂时没有加载出来" description="请稍后再试。" action={{ label: '重新加载', onPress: () => executions.refetch() }} /></Surface> : null}
        {state === 'empty' ? <Surface><EmptyState icon="🌿" title="完成的事情会出现在这里" description="先安排一个计划，我会替你记住每次结果。" suggestion="帮我整理每日重要事项" action={{ label: '安排一件事', onPress: () => router.push('/create') }} /></Surface> : null}

        {state === 'ready' ? groups.map(([label, records]) => (
          <View key={label} style={styles.dayGroup}>
            <Text style={styles.dayTitle}>{label}</Text>
            <View style={styles.timeline}>
              {records.map((item, index) => {
                const needsAttention = executionNeedsAttention(item.status);
                return (
                  <View key={item.id} style={styles.timelineRow}>
                    <View style={styles.rail}>
                      <View style={[styles.marker, needsAttention ? styles.markerWarning : styles.markerSuccess]}><Text style={styles.markerText}>{needsAttention ? '!' : '✓'}</Text></View>
                      {index < records.length - 1 ? <View style={styles.line} /> : null}
                    </View>
                    <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/executions/${item.id}` as never)} style={({ pressed }) => [styles.recordCard, pressed && styles.pressed]}>
                      <View style={styles.recordHeader}>
                        <Text style={styles.recordTitle}>{item.planName}</Text>
                        <Text style={[styles.status, needsAttention && styles.statusWarning]}>{executionAttentionLabel(item.status)}</Text>
                      </View>
                      <Text style={styles.summary}>{item.resultSummary ?? executionStatusLabel(item.status)}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
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
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 112 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  dayGroup: { marginTop: spacing.xxl },
  dayTitle: { ...typography.section, color: colors.text, marginBottom: spacing.lg },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 118 },
  rail: { width: 30, alignItems: 'center' },
  marker: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  markerSuccess: { backgroundColor: colors.success },
  markerWarning: { backgroundColor: colors.warning },
  markerText: { color: colors.surface, fontWeight: '800', fontSize: 13 },
  line: { width: 1, flex: 1, backgroundColor: colors.border },
  time: { ...typography.caption, color: colors.textMuted, width: 52, paddingTop: spacing.xs, textAlign: 'center' },
  recordCard: { flex: 1, alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginLeft: spacing.sm, marginBottom: spacing.md },
  pressed: { opacity: 0.78 },
  recordHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  recordTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  status: { ...typography.caption, color: colors.success },
  statusWarning: { color: colors.warning },
  summary: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
});
