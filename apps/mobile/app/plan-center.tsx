import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { EmptyState, PlanRow, WorkspaceHeader, colors, radius, spacing, typography } from '../src/design';
import { planCenterStatusLabel, planDomainLabel, planNextRunLabel, planStatusLabel, planStatusTone, planVisualIcon } from '../src/plan-presenter';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  domain: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  currentVersion: { name: string } | null;
  latestExecution: { status: string; resultSummary: string | null } | null;
  planCenterSummary: { kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device'; currentStatus: string } | null;
}

type Filter = 'all' | 'running' | 'paused' | 'failed';
const FILTERS: Array<{ key: Filter; label: string; icon?: 'play' | 'pause' | 'alert-circle' }> = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '进行中', icon: 'play' },
  { key: 'paused', label: '已暂停', icon: 'pause' },
  { key: 'failed', label: '失败', icon: 'alert-circle' },
];

export default function PlanCenter() {
  const token = useAuthStore((store) => store.token);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const plans = useQuery({ queryKey: ['plans', token], queryFn: () => api<PlanSummary[]>('/plans', token), enabled: Boolean(token) });
  const all = plans.data ?? [];
  const counts = useMemo(() => ({
    all: all.length,
    running: all.filter((item) => isRunning(item.status)).length,
    paused: all.filter((item) => item.status === 'paused').length,
    failed: all.filter(isFailed).length,
  }), [all]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((item) => {
      const matchesFilter = filter === 'all' || (filter === 'running' && isRunning(item.status)) || (filter === 'paused' && item.status === 'paused') || (filter === 'failed' && isFailed(item));
      const haystack = `${item.name ?? ''} ${item.currentVersion?.name ?? ''} ${item.description ?? ''} ${planDomainLabel(item.domain)}`.toLowerCase();
      return matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [all, filter, query]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}>
        <WorkspaceHeader title="计划中心" subtitle="查看和管理所有计划" onBack={() => router.back()} action={<Pressable accessibilityRole="button" accessibilityLabel="创建计划" onPress={() => router.push('/create' as never)} style={styles.add}><Ionicons name="add" size={22} color={colors.primary} /></Pressable>} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{FILTERS.map((item) => <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filter, filter === item.key && styles.filterSelected]}>{item.icon ? <Ionicons name={item.icon} size={14} color={filter === item.key ? '#FFFFFF' : item.key === 'failed' ? colors.danger : colors.textSecondary} /> : null}<Text style={[styles.filterText, filter === item.key && styles.filterTextSelected]}>{item.label}</Text><Text style={[styles.filterCount, filter === item.key && styles.filterCountSelected]}>{counts[item.key]}</Text></Pressable>)}</ScrollView>
        <View style={styles.search}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={query} onChangeText={setQuery} placeholder="搜索计划名称、领域或关键词" placeholderTextColor={colors.textMuted} style={styles.searchInput} />{query ? <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}</View>
        <View style={styles.filterLine}><Text style={styles.resultText}>{shown.length} 个计划</Text><Pressable onPress={() => router.push('/domains' as never)} style={styles.domainFilter}><Text style={styles.domainFilterText}>全部领域</Text><Ionicons name="chevron-down" size={14} color={colors.textSecondary} /></Pressable></View>

        {!token ? <EmptyState icon="shield-checkmark-outline" title="登录后查看计划" action={{ label: '去登录', onPress: () => router.push('/connections' as never) }} /> : null}
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在同步计划…</Text></View> : null}
        {plans.isError ? <EmptyState icon="cloud-offline-outline" title="计划暂时没有加载出来" action={{ label: '重新加载', onPress: () => plans.refetch() }} /> : null}
        {!plans.isLoading && token && shown.length === 0 ? <EmptyState icon="search-outline" title={query ? '没有匹配的计划' : '这个分类还没有计划'} description={query ? '换个关键词试试。' : '创建后会出现在这里。'} action={{ label: '创建计划', onPress: () => router.push('/create' as never) }} /> : null}
        {shown.length > 0 ? <View style={styles.list}>{shown.map((plan, index) => {
          const name = plan.name ?? plan.currentVersion?.name ?? '我的计划';
          const description = plan.planCenterSummary ? planCenterStatusLabel(plan.planCenterSummary.kind, plan.planCenterSummary.currentStatus) : plan.latestExecution?.resultSummary ?? plan.description ?? '按你的设置持续运行';
          return <PlanRow key={plan.id} icon={planVisualIcon(name, plan.planCenterSummary?.kind)} name={name} description={description} detail={`${planDomainLabel(plan.domain)} · ${planNextRunLabel(plan.status, plan.nextExpectedRunAt)}`} status={plan.hasMissingConnection ? '还差一步' : planStatusLabel(plan.status)} statusTone={plan.hasMissingConnection ? 'warning' : planStatusTone(plan.status)} onPress={() => router.push(`/plans/${plan.id}` as never)} last={index === shown.length - 1} />;
        })}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function isRunning(status: string) { return status === 'active' || status === 'ready'; }
function isFailed(plan: PlanSummary) { return ['failed', 'error', 'blocked'].includes(plan.status) || ['failed', 'error', 'blocked'].includes(plan.latestExecution?.status ?? ''); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  add: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  filters: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  filter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#F2F4F7' },
  filterSelected: { backgroundColor: colors.primary },
  filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  filterTextSelected: { color: '#FFFFFF' },
  filterCount: { ...typography.label, color: colors.textMuted },
  filterCountSelected: { color: '#D8F4EB' },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: '#F3F6F8', borderRadius: radius.md },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 0 },
  filterLine: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultText: { ...typography.caption, color: colors.textMuted },
  domainFilter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  domainFilterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  loading: { paddingVertical: 64, alignItems: 'center', gap: spacing.md },
  muted: { ...typography.caption, color: colors.textSecondary },
});
