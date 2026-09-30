import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { consumerPlanStatusLabel, consumerPlanStatusTone, planCenterStatusLabel, planDomainLabel, planExceptionReason, planNextRunLabel, planVisualIcon } from '../../src/plan-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];
type PlanFilter = 'all' | 'running' | 'confirmation' | 'completed';

interface PlanSummary {
  id: string; status: string; name: string | null; description: string | null; templateKey: string | null; consumerGroup?: string | null; templateVersion: string | null; domain: string | null; nextExpectedRunAt: string | null; hasMissingConnection: boolean;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
  currentVersion: { versionNumber: number; name: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: { kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device'; currentStatus: string; isException?: boolean; latestEventSummary?: string | null } | null;
}

const FILTERS: readonly { key: PlanFilter | 'records'; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'running', label: '进行中' }, { key: 'confirmation', label: '待确认' }, { key: 'completed', label: '已完成' }, { key: 'records', label: '记录' },
];
const PLAN_IMAGES: Readonly<Record<string, ImageSourcePropType>> = {
  logistics: require('../../assets/services/household-supply.jpg'), household: require('../../assets/services/home-organization.jpg'), device: require('../../assets/services/appliance-cleaning.jpg'), daily_summary: require('../../assets/services/move-in.jpg'), content: require('../../assets/services/home-cleaning.jpg'), study: require('../../assets/services/elder-care.jpg'), fallback: require('../../assets/services/household-supply.jpg'),
};

export default function Plans() {
  const token = useAuthStore((store) => store.token);
  const [filter, setFilter] = useState<PlanFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const plans = useQuery({ queryKey: ['plans', token], queryFn: () => api<PlanSummary[]>('/plans', token), enabled: Boolean(token) });
  const allPlans = plans.data ?? [];
  const activeCount = allPlans.filter(isRunning).length;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return allPlans.filter((plan) => matchesFilter(plan, filter)).filter((plan) => !normalized || `${planName(plan)} ${plan.description ?? ''} ${plan.domain ?? ''}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [allPlans, filter, query]);

  return <SafeAreaView style={styles.safeArea} edges={[]}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}>
      <View style={styles.header}><View style={styles.headerActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="搜索计划" onPress={() => setSearchOpen((value) => !value)} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="search-outline" size={21} color={colors.text} /><Text style={styles.headerActionText}>搜索</Text></Pressable>
        <View style={styles.actionDivider} />
        <Pressable accessibilityRole="button" accessibilityLabel="新建计划" onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="add-circle-outline" size={21} color={colors.text} /><Text style={styles.headerActionText}>新建</Text></Pressable>
      </View></View>

      {searchOpen ? <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜索计划名称或领域" placeholderTextColor={colors.textMuted} style={styles.searchInput} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}</View> : null}

      <View accessibilityRole="tablist" style={styles.filters}>{FILTERS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key !== 'records' && filter === item.key }} onPress={() => item.key === 'records' ? router.push('/records' as never) : setFilter(item.key)} style={[styles.filter, item.key !== 'records' && filter === item.key && styles.filterSelected]}><Text style={[styles.filterText, item.key !== 'records' && filter === item.key && styles.filterTextSelected]}>{item.label}</Text></Pressable>)}</View>

      {token && activeCount > 0 ? <Text style={styles.compactSummary}>正在进行 {activeCount} 个计划</Text> : null}

      {!token ? <InlineState icon="shield-checkmark-outline" title="登录后查看计划" description="这里只展示服务端属于你的真实计划。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
      {token && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在同步计划…</Text></View> : null}
      {token && plans.isError ? <InlineState icon="refresh-outline" title="暂时没能读取计划" description="网络恢复后可重新加载。" action="重试" onPress={() => plans.refetch()} /> : null}
      {token && !plans.isLoading && !plans.isError && filtered.length > 0 ? <View style={styles.grid}>{filtered.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</View> : null}
      {token && !plans.isLoading && !plans.isError && filtered.length === 0 ? <View style={styles.emptyPlan}><View style={styles.emptyIcon}><Ionicons name={query ? 'search-outline' : 'layers-outline'} size={21} color={colors.primary} /></View><View style={styles.emptyCopy}><Text style={styles.emptyTitle}>{query ? '没有匹配的计划' : filter === 'all' ? '还没有计划' : '这个分类暂时没有计划'}</Text><Text style={styles.emptyDescription}>{query ? '换个关键词试试。' : '从真实场景开始创建，状态会由服务端同步。'}</Text></View>{!query && filter === 'all' ? <Pressable accessibilityRole="button" onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><Text style={styles.emptyActionText}>新建</Text></Pressable> : null}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function PlanCard({ plan }: { plan: PlanSummary }) {
  const name = planName(plan);
  const kind = plan.planCenterSummary?.kind ?? 'fallback';
  const tone = consumerPlanStatusTone({ status: plan.status, hasMissingConnection: plan.hasMissingConnection });
  const status = consumerPlanStatusLabel({ status: plan.status, hasMissingConnection: plan.hasMissingConnection });
  return <Pressable accessibilityRole="button" accessibilityLabel={`${name}，${status}`} onPress={() => router.push(`/plans/${plan.id}` as never)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardVisual}><Image source={PLAN_IMAGES[kind] ?? PLAN_IMAGES.fallback} resizeMode="cover" style={styles.cardImage} /></View>
    <View style={styles.cardBody}><View style={styles.cardTitleRow}><View style={styles.cardIcon}><Ionicons name={planVisualIcon(name, plan.planCenterSummary?.kind) as IconName} size={18} color={colors.primary} /></View><Text numberOfLines={1} style={styles.cardTitle}>{name}</Text></View><Text numberOfLines={2} style={styles.cardDescription}>{planDescription(plan)}</Text><View style={[styles.statusPill, tone === 'warning' && styles.statusWarning, tone === 'muted' && styles.statusMuted]}><View style={[styles.statusDot, tone === 'warning' && styles.statusDotWarning, tone === 'muted' && styles.statusDotMuted]} /><Text style={[styles.statusText, tone === 'warning' && styles.statusTextWarning]}>{status}</Text></View><View style={styles.tags}><Text numberOfLines={1} style={styles.tag}>{planDomainLabel(plan.domain)}</Text><Text numberOfLines={1} style={styles.tag}>{planNextRunLabel(plan.status, plan.nextExpectedRunAt)}</Text></View></View>
  </Pressable>;
}

function InlineState({ icon, title, description, action, onPress }: { icon: IconName; title: string; description: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineIcon}><Ionicons name={icon} size={19} color={colors.primary} /></View><View style={styles.inlineCopy}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><Text style={styles.emptyActionText}>{action}</Text></Pressable></View>;
}

function planName(plan: PlanSummary) { return plan.name ?? plan.currentVersion?.name ?? '我的懒人计划'; }
function isRunning(plan: PlanSummary) { return ['active', 'ready', 'degraded', 'blocked'].includes(plan.status); }
function matchesFilter(plan: PlanSummary, filter: PlanFilter) { if (filter === 'all') return true; if (filter === 'running') return isRunning(plan); if (filter === 'confirmation') return ['waiting_approval', 'waiting_confirmation', 'pending_confirmation'].includes(plan.latestExecution?.status ?? '') || plan.status === 'pending_confirmation'; return ['completed', 'archived', 'succeeded'].includes(plan.status); }
function planDescription(plan: PlanSummary) { const exception = planExceptionReason(plan); if (exception) return exception; if (plan.planCenterSummary) return planCenterStatusLabel(plan.planCenterSummary.kind, plan.planCenterSummary.currentStatus); if (plan.description) return plan.description; if (plan.latestExecution?.resultSummary) return plan.latestExecution.resultSummary; return '按已确认的目标持续跟进。'; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 }, pressed: { opacity: 0.68 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }, title: { ...typography.pageTitle, color: colors.text }, headerActions: { flexDirection: 'row', alignItems: 'center' }, headerAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm }, headerActionText: { ...typography.caption, color: colors.text, fontWeight: '700' }, actionDivider: { width: 1, height: 22, marginHorizontal: 2, backgroundColor: colors.border },
  searchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 9 },
  filters: { minHeight: 50, flexDirection: 'row', alignItems: 'stretch', marginTop: spacing.md, padding: 3, borderRadius: radius.pill, backgroundColor: '#EFEEEA' }, filter: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill }, filterSelected: { backgroundColor: colors.surface, shadowColor: '#625B53', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 5, elevation: 1 }, filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' }, filterTextSelected: { color: colors.text },
  runningSummary: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#655E55', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 }, summaryIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accentSoft }, summaryCopy: { flex: 1, minWidth: 0 }, summaryTitle: { ...typography.bodyStrong, color: colors.text }, summaryCount: { color: '#5875B9', fontSize: 20 }, summaryText: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  sectionHeading: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }, sectionTitle: { ...typography.section, color: colors.text, fontSize: 20, lineHeight: 27 }, viewAll: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 }, viewAllText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  compactSummary: { ...typography.caption, color: colors.textSecondary, marginVertical: spacing.md }, grid: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, card: { width: '100%', minHeight: 94, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, cardVisual: { width: 76, height: 76, borderRadius: 12, overflow: 'hidden', backgroundColor: '#ECE8E1' }, cardImage: { width: '100%', height: '100%' }, cardBody: { flex: 1, minHeight: 88, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, cardIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accentSoft }, cardTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, cardDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 17, marginTop: 2 },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#E4F5E7' }, statusWarning: { backgroundColor: '#FFF0D8' }, statusMuted: { backgroundColor: '#E9EEFA' }, statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#27A653' }, statusDotWarning: { backgroundColor: '#D48816' }, statusDotMuted: { backgroundColor: '#5275D6' }, statusText: { fontSize: 9, lineHeight: 13, color: '#188C3E', fontWeight: '800' }, statusTextWarning: { color: '#B66A00' }, tags: { flexDirection: 'row', gap: 4, marginTop: spacing.sm }, tag: { maxWidth: '49%', color: colors.textSecondary, fontSize: 8, lineHeight: 12, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#F0F0EE', overflow: 'hidden' },
  loading: { paddingVertical: 64, alignItems: 'center', gap: spacing.md }, loadingText: { ...typography.caption, color: colors.textSecondary }, inlineState: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm }, inlineIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accentSoft }, inlineCopy: { flex: 1, minWidth: 0 }, emptyPlan: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, emptyIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accentSoft }, emptyCopy: { flex: 1, minWidth: 0 }, emptyTitle: { ...typography.bodyStrong, color: colors.text }, emptyDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 2 }, emptyAction: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.primary }, emptyActionText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '800' },
});
