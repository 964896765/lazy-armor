import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import {
  buildAttentionSections,
  type AttentionReconciliation,
  type AttentionToday,
} from '../src/attention-presenter';
import { EmptyState, MessageRow, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../src/design';

export default function AttentionPage() {
  const token = useAuthStore((store) => store.token);
  const today = useQuery({
    queryKey: ['attention-today', token],
    queryFn: () => api<AttentionToday>('/today', token),
    enabled: Boolean(token),
    refetchInterval: 10_000,
  });
  const reconciliation = useQuery({
    queryKey: ['attention-reconciliation', token],
    queryFn: () => api<AttentionReconciliation[]>('/reconciliation-cases', token),
    enabled: Boolean(token),
    refetchInterval: 10_000,
  });
  const sections = useMemo(() => buildAttentionSections(today.data, reconciliation.data ?? []), [today.data, reconciliation.data]);
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const loading = today.isLoading || reconciliation.isLoading;
  const error = today.isError || reconciliation.isError;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={today.isFetching || reconciliation.isFetching} onRefresh={() => { void today.refetch(); void reconciliation.refetch(); }} /> : undefined}
      >
        <WorkspaceHeader title="需要你留意" subtitle="审批、异常、授权失效和结果待确认都收在这里" onBack={() => router.back()} />

        {!token ? (
          <Surface style={styles.stateSurface}><EmptyState icon="notifications-outline" title="登录后查看需要你处理的事" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface>
        ) : null}

        {token && loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在核对需要你处理的事…</Text></View>
        ) : null}

        {token && !loading && error ? (
          <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="暂时没有加载出来" description="请稍后再试，不会影响已有计划。" action={{ label: '重新加载', onPress: () => { void today.refetch(); void reconciliation.refetch(); } }} /></Surface>
        ) : null}

        {token && !loading && !error && total === 0 ? (
          <View style={styles.emptyState}><View style={styles.emptyIcon}><Ionicons name="checkmark" size={18} color={colors.success} /></View><View style={styles.emptyCopy}><Text style={styles.emptyTitle}>没有需要你处理的事</Text><Text style={styles.emptyDescription}>计划会继续运行，只有真正需要你决定或处理的事才会出现。</Text></View></View>
        ) : null}

        {token && !loading && !error && total > 0 ? sections.map((section) => (
          <WorkspaceSection key={section.key} title={section.title} count={section.rows.length}>
            <View style={styles.group}>
              {section.rows.map((row, index) => (
                <MessageRow
                  key={row.id}
                  icon={row.icon}
                  title={row.source}
                  description={`${row.title} · ${row.status}`}
                  meta={row.meta || undefined}
                  tone={row.tone}
                  last={index === section.rows.length - 1}
                  onPress={row.route ? () => router.push(row.route as never) : undefined}
                />
              ))}
            </View>
          </WorkspaceSection>
        )) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  stateSurface: { marginTop: spacing.xl },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  emptyState: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  emptyCopy: { flex: 1 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  group: { backgroundColor: colors.surface, paddingHorizontal: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
});
