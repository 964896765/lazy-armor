import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Image, type ImageSourcePropType, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { listCreationDrafts } from '../../src/creation-draft-api';
import { activeCreationDraftCount } from '../../src/creation-draft-presenter';
import { EmptyState, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import {
  HOME_SPACES,
  homeDomainsForSpace,
  presentRunningPlan,
  selectRunningPlanCards,
  type HomeDomainNode,
  type HomeRecentPlan,
  type HomeSpaceKey,
} from '../../src/home-presenter';

interface TodayData { recentPlans: HomeRecentPlan[] }

type IconName = ComponentProps<typeof Ionicons>['name'];

const PLAN_IMAGES: readonly ImageSourcePropType[] = [
  require('../../assets/services/household-supply.jpg'),
  require('../../assets/services/home-cleaning.jpg'),
  require('../../assets/services/appliance-cleaning.jpg'),
];

const DOMAIN_VISUALS: Readonly<Record<string, { icon: IconName; color: string }>> = {
  life: { icon: 'sparkles-outline', color: '#D6935F' }, family: { icon: 'home', color: '#E0955E' }, health: { icon: 'heart', color: '#F06C6C' }, social: { icon: 'people', color: '#B79B89' }, pet: { icon: 'paw', color: '#D1906E' }, travel: { icon: 'airplane', color: '#7898C7' }, entertainment: { icon: 'film', color: '#987DC2' },
  finance: { icon: 'wallet', color: '#5F9B82' }, housing: { icon: 'business', color: '#D6935F' }, vehicle: { icon: 'car', color: '#65A2B2' }, device: { icon: 'phone-portrait', color: '#6D8EB9' }, digital_account: { icon: 'key', color: '#917DC4' },
  identity_docs: { icon: 'id-card', color: '#5F8FB8' }, government: { icon: 'library', color: '#6488C4' }, legal_contract: { icon: 'document-text', color: '#C68A5E' }, work: { icon: 'briefcase', color: '#647DAC' }, operations: { icon: 'analytics', color: '#5E9A83' }, content: { icon: 'create', color: '#A47BC0' }, study: { icon: 'school', color: '#5A8EC7' },
};

function scenarioIcon(label: string, fallback: IconName): IconName {
  if (/快递|物流/.test(label)) return 'cube-outline';
  if (/缴费|账单|财务|预算/.test(label)) return 'wallet-outline';
  if (/补给|采购|购物/.test(label)) return 'cart-outline';
  if (/预约|日程|复诊/.test(label)) return 'calendar-outline';
  if (/待办|任务|事项/.test(label)) return 'checkbox-outline';
  if (/成员|社交|关系/.test(label)) return 'people-outline';
  if (/药|健康|体检/.test(label)) return 'medkit-outline';
  if (/行程|出行|旅行|票/.test(label)) return 'airplane-outline';
  if (/车辆|汽车/.test(label)) return 'car-outline';
  if (/设备|耗材/.test(label)) return 'hardware-chip-outline';
  if (/住房|家居|房屋/.test(label)) return 'home-outline';
  if (/学习|课程/.test(label)) return 'school-outline';
  if (/内容|创作/.test(label)) return 'create-outline';
  return fallback;
}

export default function HomePage() {
  const token = useAuthStore((store) => store.token);
  const [space, setSpace] = useState<HomeSpaceKey>('life');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(homeDomainsForSpace('life').map((item) => item.key)));
  const today = useQuery({ queryKey: ['today', token], queryFn: () => api<TodayData>('/today', token), enabled: Boolean(token), refetchInterval: 15_000 });
  const drafts = useQuery({ queryKey: ['creation-drafts', token], queryFn: () => listCreationDrafts(token!), enabled: Boolean(token) });
  const cards = useMemo(() => selectRunningPlanCards(today.data?.recentPlans ?? []), [today.data?.recentPlans]);
  const domains = useMemo(() => homeDomainsForSpace(space), [space]);
  const resumeDraftCount = activeCreationDraftCount(drafts.data ?? []);

  function selectSpace(next: HomeSpaceKey) { setSpace(next); setExpanded(new Set(homeDomainsForSpace(next).map((item) => item.key))); }
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
        <View style={[styles.sectionHeading, styles.createHeading]}><Text style={styles.sectionTitle}>新建计划</Text></View>
        {resumeDraftCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`继续创建 ${resumeDraftCount} 份草稿`} onPress={() => router.push('/create-wizard' as never)} style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}>
          <View style={styles.resumeIcon}><Ionicons name="construct-outline" size={19} color={colors.primary} /></View>
          <View style={styles.resumeCopy}><Text style={styles.resumeTitle}>继续创建 {resumeDraftCount}</Text><Text style={styles.resumeDetail}>服务端记录了你进行中的创建草稿，恢复前会重新校验授权与方案有效期。</Text></View>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable> : null}
        <View style={styles.spaces}>
          {HOME_SPACES.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === space }} onPress={() => selectSpace(item.key)} style={[styles.spacePill, item.key === space && styles.spacePillSelected]}><Text style={[styles.spaceText, item.key === space && styles.spaceTextSelected]}>{item.label}</Text></Pressable>)}
        </View>
        <View style={styles.tree}>{domains.map((domain, index) => <DomainTreeNode key={domain.key} domain={domain} expanded={expanded.has(domain.key)} last={index === domains.length - 1} onToggle={() => toggleDomain(domain.key)} />)}</View>
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
          <View style={styles.planVisual}><Image source={PLAN_IMAGES[index % PLAN_IMAGES.length]} resizeMode="cover" style={styles.planImage} /><View style={styles.planMore}><Ionicons name="ellipsis-horizontal" size={18} color={colors.text} /></View></View>
          <View style={styles.planBody}><View style={styles.planTitleRow}><Text numberOfLines={1} style={styles.planName}>{plan.planName ?? '未命名计划'}</Text><Ionicons name="chevron-forward" size={16} color={colors.textSecondary} /></View>
          <View style={[styles.statusPill, presentation.tone === 'warning' && styles.statusWarning, presentation.tone === 'muted' && styles.statusMuted]}><View style={[styles.statusDot, presentation.tone === 'warning' && styles.statusDotWarning]} /><Text style={[styles.statusText, presentation.tone === 'warning' && styles.statusTextWarning]}>{presentation.label}</Text></View>
          <Text numberOfLines={2} style={styles.planSummary}>{presentation.summary}</Text>
          <Text style={styles.cardTime}>{formatActivity(plan.lastActivityAt)}</Text></View>
        </Pressable>;
      })}
    </ScrollView>
    {plans.length > 1 ? <View accessibilityLabel={`当前第 ${active + 1} 张，共 ${plans.length} 张`} style={styles.dots}>{plans.map((plan, index) => <View key={plan.planId} style={[styles.dot, index === active && styles.dotActive]} />)}</View> : null}
  </View>;
}

function DomainTreeNode({ domain, expanded, last, onToggle }: { domain: HomeDomainNode; expanded: boolean; last: boolean; onToggle: () => void }) {
  const visual = DOMAIN_VISUALS[domain.key] ?? { icon: 'ellipse', color: colors.primary };
  return <View style={!last && styles.domainDivider}>
    <View style={styles.domainRow}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => [styles.domainToggle, pressed && styles.rowPressed]}><Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={17} color={colors.textSecondary} /><Ionicons name={visual.icon} size={25} color={visual.color} /><Text style={styles.domainName}>{domain.label}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${domain.label}领域`} onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.rowMore, pressed && styles.rowPressed]}><Ionicons name="ellipsis-horizontal" size={17} color={colors.textSecondary} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`在${domain.label}中选择场景`} onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.rowAdd, pressed && styles.rowPressed]}><Ionicons name="add" size={20} color={colors.primary} /></Pressable>
    </View>
    {expanded ? <View style={styles.scenarioList}>{domain.scenarios.map((scenario) => <View key={`${scenario.productDomain}.${scenario.key}`} style={styles.scenarioRow}>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${scenario.productDomain}/${scenario.key}` as never)} style={({ pressed }) => [styles.scenarioMain, pressed && styles.rowPressed]}><Ionicons name={scenarioIcon(scenario.label, visual.icon)} size={19} color={visual.color} /><Text numberOfLines={1} style={styles.scenarioName}>{scenario.label}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${scenario.label}详情`} onPress={() => router.push(`/domains/${scenario.productDomain}/${scenario.key}` as never)} style={({ pressed }) => [styles.rowMore, pressed && styles.rowPressed]}><Ionicons name="ellipsis-horizontal" size={17} color={colors.textSecondary} /></Pressable>
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
  emptyRunning: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#746B61', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 }, emptyRunningIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accentSoft }, emptyRunningCopy: { flex: 1 }, emptyRunningTitle: { ...typography.bodyStrong, color: colors.text },
  cards: { gap: spacing.md, paddingVertical: spacing.sm, paddingRight: 52 }, planCard: { minHeight: 220, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#6F6658', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 14, elevation: 2 }, planCardSide: { transform: [{ scale: 0.94 }, { rotate: '-1deg' }], opacity: 0.86 },
  planVisual: { height: 112, backgroundColor: '#EEEAE3' }, planImage: { width: '100%', height: '100%' }, planMore: { position: 'absolute', right: spacing.md, bottom: -18, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.surface, shadowColor: '#605950', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, elevation: 2 }, planBody: { flex: 1, padding: spacing.md }, planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.successSoft }, statusWarning: { backgroundColor: '#F7ECD9' }, statusMuted: { backgroundColor: '#EFEEEA' }, statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2FA86D' }, statusDotWarning: { backgroundColor: '#D48A32' }, statusText: { fontSize: 10, lineHeight: 14, color: colors.primary, fontWeight: '800' }, statusTextWarning: { color: '#96622B' },
  planName: { ...typography.cardTitle, color: colors.text, flex: 1 }, planSummary: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs }, cardTime: { fontSize: 9, lineHeight: 13, color: colors.textMuted, marginTop: spacing.sm },
  dots: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5D2CB' }, dotActive: { width: 16, backgroundColor: colors.primary }, boundary: { fontSize: 10, lineHeight: 15, color: colors.textMuted, marginTop: spacing.xs },
  createHeading: { marginTop: spacing.xl }, sectionDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 19 }, resumeCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, resumeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, resumeCopy: { flex: 1, minWidth: 0 }, resumeTitle: { ...typography.bodyStrong, color: colors.text }, resumeDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 18 }, spaces: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md }, spacePill: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#EFEEEA' }, spacePillSelected: { backgroundColor: '#DCEBE4' }, spaceText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' }, spaceTextSelected: { color: colors.text },
  tree: { backgroundColor: 'transparent' }, domainDivider: {}, domainRow: { flexDirection: 'row', alignItems: 'center' }, domainToggle: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowMore: { width: 34, height: 42, marginRight: 2, alignItems: 'center', justifyContent: 'center' }, rowAdd: { width: 34, height: 42, alignItems: 'center', justifyContent: 'center' }, domainName: { ...typography.bodyStrong, color: colors.text, flex: 1 }, domainCount: { ...typography.caption, color: colors.textMuted }, scenarioList: { paddingBottom: spacing.xs, marginLeft: 34 }, scenarioRow: { flexDirection: 'row', alignItems: 'center' }, scenarioMain: { flex: 1, minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md }, branch: { width: 8, height: 1, marginLeft: -spacing.md, backgroundColor: colors.border }, scenarioName: { ...typography.body, color: colors.text, flex: 1 }, scenarioBoundary: { fontSize: 9, lineHeight: 13, color: colors.textMuted }, rowPressed: { backgroundColor: colors.pressed }, catalogBoundary: { fontSize: 10, lineHeight: 15, color: colors.textMuted, marginTop: spacing.sm },
  inlineState: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, inlineCopy: { flex: 1 }, inlineAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary }, inlineActionText: { ...typography.caption, color: '#FFFFFF', fontWeight: '800' },
});
