import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import {
  HOME_DATA_BOUNDARY,
  HOME_SPACES,
  homeDomainsForSpace,
  presentRunningPlan,
  selectRunningPlanCards,
  type HomeDomainNode,
  type HomeRecentPlan,
  type HomeSpaceKey,
} from '../../src/home-presenter';

interface TodayData { recentPlans: HomeRecentPlan[] }

export default function HomePage() {
  const token = useAuthStore((store) => store.token);
  const [space, setSpace] = useState<HomeSpaceKey>('life');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const today = useQuery({ queryKey: ['today', token], queryFn: () => api<TodayData>('/today', token), enabled: Boolean(token), refetchInterval: 15_000 });
  const cards = useMemo(() => selectRunningPlanCards(today.data?.recentPlans ?? []), [today.data?.recentPlans]);
  const domains = useMemo(() => homeDomainsForSpace(space), [space]);

  function selectSpace(next: HomeSpaceKey) { setSpace(next); setExpanded(new Set()); }
  function toggleDomain(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeArea}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={today.isFetching} onRefresh={() => today.refetch()} /> : undefined}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>正在进行</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/plan-center?filter=running' as never)} style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
            <Text style={styles.textActionLabel}>查看全部</Text><Ionicons name="chevron-forward" size={15} color={colors.primary} />
          </Pressable>
        </View>
        {!token ? <EmptyState icon="shield-checkmark-outline" title="登录后查看计划" description="这里只展示服务端属于你的真实计划。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /> : null}
        {token && today.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取服务端计划投影…</Text></View> : null}
        {token && today.isError ? <InlineState title="暂时无法读取计划" detail="不会用本地示例替代服务端数据。" action="重试" onPress={() => today.refetch()} /> : null}
        {token && !today.isLoading && !today.isError && cards.length === 0 ? <View style={styles.emptyRunning}><View style={styles.emptyRunningIcon}><Ionicons name="layers-outline" size={20} color={colors.primary} /></View><View style={styles.emptyRunningCopy}><Text style={styles.emptyRunningTitle}>没有正在管理的计划</Text><Text style={styles.muted}>从下方规范场景进入详情，查看真实可用能力。</Text></View></View> : null}
        {cards.length > 0 ? <RunningPlanCarousel plans={cards} /> : null}
        {token ? <Text style={styles.boundary}>{HOME_DATA_BOUNDARY}</Text> : null}

        <View style={[styles.sectionHeading, styles.createHeading]}><Text style={styles.sectionTitle}>新建计划</Text></View>
        <Text style={styles.sectionDescription}>先从规范目录选择场景。是否能够创建，以场景详情中的服务端可用性证据为准。</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spaces}>
          {HOME_SPACES.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === space }} onPress={() => selectSpace(item.key)} style={[styles.spacePill, item.key === space && styles.spacePillSelected]}><Text style={[styles.spaceText, item.key === space && styles.spaceTextSelected]}>{item.label}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.tree}>{domains.map((domain, index) => <DomainTreeNode key={domain.key} domain={domain} expanded={expanded.has(domain.key)} last={index === domains.length - 1} onToggle={() => toggleDomain(domain.key)} />)}</View>
        <Text style={styles.catalogBoundary}>目录沿用既有 19 领域与场景身份；这里不把目录存在解释为能力已开通。</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function RunningPlanCarousel({ plans }: { plans: readonly HomeRecentPlan[] }) {
  const { width } = useWindowDimensions();
  const [active, setActive] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const cardWidth = Math.min(245, Math.max(220, width - 96));
  const interval = cardWidth + spacing.md;
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={reduceMotion ? undefined : interval} decelerationRate={reduceMotion ? 'normal' : 'fast'} disableIntervalMomentum={!reduceMotion} contentContainerStyle={styles.cards} onMomentumScrollEnd={(event) => setActive(Math.min(plans.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / interval))))}>
      {plans.map((plan, index) => {
        const presentation = presentRunningPlan(plan);
        return <Pressable key={plan.planId} accessibilityRole="button" accessibilityLabel={`第 ${index + 1} 张，共 ${plans.length} 张。${plan.planName ?? '未命名计划'}，${presentation.label}。${presentation.summary}`} onPress={() => router.push(`/plans/${plan.planId}` as never)} style={({ pressed }) => [styles.planCard, { width: cardWidth }, !reduceMotion && index !== active && styles.planCardSide, pressed && styles.pressed]}>
          <View style={styles.cardTop}><View style={styles.planIcon}><Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} /></View><View style={[styles.statusPill, presentation.tone === 'warning' && styles.statusWarning, presentation.tone === 'muted' && styles.statusMuted]}><Text style={[styles.statusText, presentation.tone === 'warning' && styles.statusTextWarning]}>{presentation.label}</Text></View></View>
          <Text numberOfLines={1} style={styles.planName}>{plan.planName ?? '未命名计划'}</Text>
          <Text numberOfLines={3} style={styles.planSummary}>{presentation.summary}</Text>
          <View style={styles.cardFooter}><Text style={styles.cardTime}>{formatActivity(plan.lastActivityAt)}</Text><Text style={styles.cardNext}>查看详情与下一步</Text></View>
        </Pressable>;
      })}
    </ScrollView>
    {plans.length > 1 ? <View accessibilityLabel={`当前第 ${active + 1} 张，共 ${plans.length} 张`} style={styles.dots}>{plans.map((plan, index) => <View key={plan.planId} style={[styles.dot, index === active && styles.dotActive]} />)}</View> : null}
  </View>;
}

function DomainTreeNode({ domain, expanded, last, onToggle }: { domain: HomeDomainNode; expanded: boolean; last: boolean; onToggle: () => void }) {
  return <View style={!last && styles.domainDivider}>
    <View style={styles.domainRow}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => [styles.domainToggle, pressed && styles.rowPressed]}><Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.primary} /><Text style={styles.domainName}>{domain.label}</Text><Text style={styles.domainCount}>{domain.scenarios.length} 个场景</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`在${domain.label}中选择场景`} onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.rowAdd, pressed && styles.rowPressed]}><Ionicons name="add" size={20} color={colors.primary} /></Pressable>
    </View>
    {expanded ? <View style={styles.scenarioList}>{domain.scenarios.map((scenario) => <View key={`${scenario.productDomain}.${scenario.key}`} style={styles.scenarioRow}>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${scenario.productDomain}/${scenario.key}` as never)} style={({ pressed }) => [styles.scenarioMain, pressed && styles.rowPressed]}><View style={styles.branch} /><Text style={styles.scenarioName}>{scenario.label}</Text><Text style={styles.scenarioBoundary}>查看真实状态</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`为${scenario.label}创建计划`} onPress={() => router.push(`/create?scenarioKey=${scenario.productDomain}.${scenario.key}` as never)} style={({ pressed }) => [styles.rowAdd, pressed && styles.rowPressed]}><Ionicons name="add" size={20} color={colors.primary} /></Pressable>
    </View>)}</View> : null}
  </View>;
}

function InlineState({ title, detail, action, onPress }: { title: string; detail: string; action: string; onPress: () => void }) { return <View style={styles.inlineState}><View style={styles.inlineCopy}><Text style={styles.emptyRunningTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Pressable accessibilityRole="button" onPress={onPress} style={styles.inlineAction}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>; }
function formatActivity(value: string | null) { if (!value) return '暂无活动时间'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '活动时间不可用' : `最近活动 ${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  sectionHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, sectionTitle: { ...typography.section, color: colors.text, fontSize: 18, lineHeight: 25 },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md }, textActionLabel: { ...typography.caption, color: colors.primary, fontWeight: '700' }, pressed: { opacity: 0.72 },
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.md }, muted: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  emptyRunning: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, emptyRunningIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accentSoft }, emptyRunningCopy: { flex: 1 }, emptyRunningTitle: { ...typography.bodyStrong, color: colors.text },
  cards: { gap: spacing.md, paddingVertical: spacing.sm, paddingRight: 52 }, planCard: { minHeight: 220, padding: spacing.lg, justifyContent: 'space-between', borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#6F6658', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 2 }, planCardSide: { transform: [{ scale: 0.97 }], opacity: 0.88 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, planIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.accentSoft }, statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.successSoft }, statusWarning: { backgroundColor: '#F7ECD9' }, statusMuted: { backgroundColor: '#EFEEEA' }, statusText: { fontSize: 10, lineHeight: 14, color: colors.primary, fontWeight: '800' }, statusTextWarning: { color: '#96622B' },
  planName: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, planSummary: { ...typography.body, color: colors.textSecondary, lineHeight: 21, marginTop: spacing.sm, flex: 1 }, cardFooter: { marginTop: spacing.lg, gap: 3 }, cardTime: { fontSize: 10, lineHeight: 14, color: colors.textMuted }, cardNext: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  dots: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5D2CB' }, dotActive: { width: 16, backgroundColor: colors.primary }, boundary: { fontSize: 10, lineHeight: 15, color: colors.textMuted, marginTop: spacing.xs },
  createHeading: { marginTop: spacing.xl }, sectionDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 19 }, spaces: { gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.lg }, spacePill: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#EFEEEA', borderWidth: 1, borderColor: '#E5E2DB' }, spacePillSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, spaceText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' }, spaceTextSelected: { color: '#FFFFFF' },
  tree: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, domainDivider: { borderBottomWidth: 1, borderBottomColor: colors.border }, domainRow: { flexDirection: 'row', alignItems: 'center' }, domainToggle: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md }, rowAdd: { width: 48, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, domainName: { ...typography.bodyStrong, color: colors.text, flex: 1 }, domainCount: { ...typography.caption, color: colors.textMuted }, scenarioList: { paddingBottom: spacing.xs, backgroundColor: '#FCFBF8' }, scenarioRow: { flexDirection: 'row', alignItems: 'center' }, scenarioMain: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 38 }, branch: { width: 8, height: 1, backgroundColor: '#CFCBC2' }, scenarioName: { ...typography.body, color: colors.text, flex: 1 }, scenarioBoundary: { fontSize: 9, lineHeight: 13, color: colors.textMuted }, rowPressed: { backgroundColor: colors.pressed }, catalogBoundary: { fontSize: 10, lineHeight: 15, color: colors.textMuted, marginTop: spacing.sm },
  inlineState: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, inlineCopy: { flex: 1 }, inlineAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary }, inlineActionText: { ...typography.caption, color: '#FFFFFF', fontWeight: '800' },
});
