import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { filterServicePlans, type PresentedServicePlan, type ServiceKind, type ServicePlanProjection, type ServiceSection } from '../../src/service-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];

const SECTIONS: readonly { key: ServiceSection; label: string }[] = [
  { key: 'recommended', label: '推荐' },
  { key: 'following', label: '关注' },
  { key: 'nearby', label: '附近' },
  { key: 'active', label: '服务中' },
];

const KINDS: readonly { key: ServiceKind; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'plan', label: '方案' },
  { key: 'service', label: '服务' },
  { key: 'supply', label: '补给' },
];

export default function ServicesSpace() {
  const token = useAuthStore((store) => store.token);
  const [section, setSection] = useState<ServiceSection>('recommended');
  const [kind, setKind] = useState<ServiceKind>('all');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const plans = useQuery({
    queryKey: ['service-plans', token],
    queryFn: () => api<ServicePlanProjection[]>('/plans', token),
    enabled: Boolean(token),
    staleTime: 15_000,
  });
  const cards = useMemo(() => filterServicePlans(plans.data ?? [], section, query, kind), [plans.data, section, query, kind]);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
      >
        <View style={styles.headingRow}>
          <Text style={styles.heading}>服务</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={filtersOpen ? '收起筛选' : '打开筛选'} accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen((value) => !value)} style={({ pressed }) => [styles.filterButton, filtersOpen && styles.filterButtonSelected, pressed && styles.pressed]}>
            <Ionicons name="options-outline" size={20} color={filtersOpen ? '#FFFFFF' : colors.text} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索你的方案与服务计划" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={styles.clearButton}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
        </View>

        {filtersOpen ? <View accessibilityRole="tablist" style={styles.kindFilters}>{KINDS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: kind === item.key }} onPress={() => setKind(item.key)} style={[styles.kindChip, kind === item.key && styles.kindChipSelected]}><Text style={[styles.kindChipText, kind === item.key && styles.kindChipTextSelected]}>{item.label}</Text></Pressable>)}</View> : null}

        <View accessibilityRole="tablist" style={styles.sectionTabs}>{SECTIONS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: section === item.key }} onPress={() => setSection(item.key)} style={[styles.sectionTab, section === item.key && styles.sectionTabSelected]}><Text style={[styles.sectionTabText, section === item.key && styles.sectionTabTextSelected]}>{item.label}</Text></Pressable>)}</View>

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="briefcase-outline" title="登录后查看服务" description="这里只展示属于你的真实计划、执行结果与可用服务状态。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取服务端计划…</Text></View> : null}
        {token && plans.isError ? <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="暂时无法读取服务" description="不会用本地示例替代服务端结果。" action={{ label: '重试', onPress: () => plans.refetch() }} /></Surface> : null}
        {token && !plans.isLoading && !plans.isError && cards.length > 0 ? <View style={styles.grid}>{cards.map((card) => <ServiceCard key={card.id} card={card} />)}</View> : null}
        {token && !plans.isLoading && !plans.isError && cards.length === 0 ? <SectionEmpty section={section} searching={Boolean(query.trim())} /> : null}

        {token ? <View style={styles.boundary}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} /><Text style={styles.boundaryText}>方案、状态和结果来自服务端真实投影。价格、商家、距离、下单和支付在可信接口接入前不会展示或推断。</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ServiceCard({ card }: { card: PresentedServicePlan }) {
  const icon: IconName = card.kind === 'supply' ? 'cart-outline' : card.kind === 'service' ? 'construct-outline' : 'cube-outline';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${card.kindLabel}，${card.title}，${card.statusLabel}`} onPress={() => router.push(`/plans/${card.id}` as never)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={[styles.cardVisual, card.kind === 'service' && styles.cardVisualService, card.kind === 'supply' && styles.cardVisualSupply]}>
        <View style={styles.cardBadge}><Ionicons name={icon} size={14} color="#FFFFFF" /><Text style={styles.cardBadgeText}>{card.kindLabel}</Text></View>
        <Ionicons name={icon} size={48} color="rgba(40,52,48,0.2)" />
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardTitle}>{card.title}</Text>
        <Text numberOfLines={2} style={styles.cardSummary}>{card.summary}</Text>
        <View style={styles.cardFooter}><Text numberOfLines={1} style={styles.cardStatus}>{card.statusLabel}</Text><View style={styles.cardAction}><Text style={styles.cardActionText}>{card.actionLabel}</Text><Ionicons name="chevron-forward" size={13} color={colors.text} /></View></View>
      </View>
    </Pressable>
  );
}

function SectionEmpty({ section, searching }: { section: ServiceSection; searching: boolean }) {
  if (searching) return <Surface style={styles.stateSurface}><EmptyState icon="search-outline" title="没有匹配结果" description="当前服务端计划中没有符合搜索词和筛选条件的项目。" /></Surface>;
  if (section === 'following') return <Surface style={styles.stateSurface}><EmptyState icon="heart-outline" title="还没有关注的服务" description="服务关注能力尚未接入服务端；不会在本地伪造关注状态。" /></Surface>;
  if (section === 'nearby') return <Surface style={styles.stateSurface}><EmptyState icon="location-outline" title="附近服务尚未接入" description="需要经过授权的位置来源和真实服务商接口后才能展示距离与可预约状态。" action={{ label: '查看连接', onPress: () => router.push('/connections' as never) }} /></Surface>;
  if (section === 'active') return <Surface style={styles.stateSurface}><EmptyState icon="time-outline" title="当前没有服务中的计划" description="服务端没有返回进行中、已暂停或等待处理的计划。" action={{ label: '查看全部计划', onPress: () => router.push('/plans' as never) }} /></Surface>;
  return <Surface style={styles.stateSurface}><EmptyState icon="sparkles-outline" title="还没有可展示的服务方案" description="先从真实场景创建计划，服务页会同步展示服务端状态。" action={{ label: '选择场景', onPress: () => router.push('/' as never) }} /></Surface>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  headingRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typography.display, color: colors.text, fontSize: 25, lineHeight: 32 },
  filterButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterButtonSelected: { backgroundColor: colors.text, borderColor: colors.text },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 10 },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  kindFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.md },
  kindChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kindChipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  kindChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  kindChipTextSelected: { color: '#FFFFFF' },
  sectionTabs: { minHeight: 52, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.md, padding: 3, borderRadius: radius.pill, backgroundColor: '#EDEDEB' },
  sectionTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  sectionTabSelected: { backgroundColor: colors.surface, shadowColor: '#524B42', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  sectionTabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  sectionTabTextSelected: { color: colors.text, fontWeight: '800' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: { ...typography.body, color: colors.textSecondary },
  stateSurface: { marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', rowGap: spacing.md },
  card: { width: '48.4%', overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  cardVisual: { height: 104, alignItems: 'flex-end', justifyContent: 'flex-end', padding: spacing.md, backgroundColor: '#DEDCD6' },
  cardVisualService: { backgroundColor: '#D8DDD8' },
  cardVisualSupply: { backgroundColor: '#E5DED3' },
  cardBadge: { position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.md, backgroundColor: 'rgba(25,27,26,0.82)' },
  cardBadgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 14, fontWeight: '800' },
  cardBody: { minHeight: 142, padding: spacing.md },
  cardTitle: { ...typography.bodyStrong, color: colors.text },
  cardSummary: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 4, minHeight: 36 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, marginTop: spacing.md },
  cardStatus: { color: colors.primary, fontSize: 9, lineHeight: 13, fontWeight: '800', flex: 1 },
  cardAction: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  cardActionText: { color: colors.text, fontSize: 9, lineHeight: 13, fontWeight: '800' },
  boundary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  boundaryText: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, flex: 1 },
  pressed: { opacity: 0.72 },
});
