import { useQuery } from '@tanstack/react-query';
import { canonicalPlanDomain, domainDefinition, scenariosForDomain } from '@lazy-armor/plan-schema/mobile';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, PlanRow, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';
import { planNextRunLabel, planStatusLabel, planStatusTone, planVisualIcon } from '../../src/plan-presenter';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  domain: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  currentVersion: { name: string } | null;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
}
interface ConnectionSummary { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }

type DomainTab = '概览' | '计划' | '资料' | '动态';
const TABS: DomainTab[] = ['概览', '计划', '资料', '动态'];

export default function DomainWorkspace() {
  const { domain: rawDomain } = useLocalSearchParams<{ domain?: string | string[] }>();
  const domainKey = Array.isArray(rawDomain) ? rawDomain[0] : rawDomain;
  const definition = domainDefinition(domainKey);
  const [tab, setTab] = useState<DomainTab>('概览');
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['domain-plans', token, definition?.key],
    queryFn: () => api<PlanSummary[]>('/plans', token),
    enabled: Boolean(token && definition),
  });
  const connections = useQuery({ queryKey: ['domain-connections', token], queryFn: () => api<ConnectionSummary[]>('/connections', token), enabled: Boolean(token && definition) });
  const domainPlans = useMemo(() => (plans.data ?? []).filter((plan) => canonicalPlanDomain(plan.domain) === definition?.key), [plans.data, definition?.key]);
  const activePlans = domainPlans.filter((plan) => plan.status === 'active' || plan.status === 'ready');
  const latest = [...domainPlans].sort((left, right) => (right.latestExecution?.createdAt ?? '').localeCompare(left.latestExecution?.createdAt ?? ''))[0]?.latestExecution ?? null;

  if (!definition) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.invalid}><EmptyState icon="help-circle-outline" title="未找到这个领域" description="请从“我的领域”中选择要查看的生活空间。" action={{ label: '查看领域目录', onPress: () => router.replace('/domains' as never) }} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <WorkspaceHeader title="领域详情" subtitle="管理这个领域的来源、计划与动态" onBack={() => router.back()} />
        <DomainHero domain={definition.key} label={definition.label} description={domainDescription(definition.key)} />
        <View style={styles.tabs}>{TABS.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setTab(item)} style={[styles.tab, item === tab && styles.tabSelected]}><Text style={[styles.tabText, item === tab && styles.tabTextSelected]}>{item}</Text></Pressable>)}</View>
        {!token ? <Surface><EmptyState icon="grid-outline" title="登录后查看你的领域" description="只有你本人可查看与管理自己的计划和资料。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在读取{definition.label}…</Text></View> : null}
        {token && !plans.isLoading && tab === '概览' ? <Overview domain={definition.key} plans={domainPlans} activePlans={activePlans.length} latest={latest} connections={(connections.data ?? []).filter((item) => item.status !== 'revoked')} /> : null}
        {token && !plans.isLoading && tab === '计划' ? <PlansSection plans={domainPlans} label={definition.label} /> : null}
        {token && !plans.isLoading && tab === '资料' ? <ResourcesSection domain={definition.key} /> : null}
        {token && !plans.isLoading && tab === '动态' ? <ActivitySection plans={domainPlans} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DomainHero({ domain, label, description }: { domain: string; label: string; description: string }) {
  const scenarios = scenariosForDomain(domain);
  return (
    <View style={styles.domainHero}>
      <View style={styles.heroHeading}>
        <View style={styles.heroIcon}><Ionicons name={domainIcon(domain)} size={28} color="#FFFFFF" /></View>
        <View style={styles.heroCopy}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>{label}</Text><Text style={styles.enabledBadge}>已启用</Text></View><Text style={styles.heroDescription}>{description}</Text></View>
      </View>
      <View style={styles.heroScenarioGrid}>{scenarios.map((scenario) => <Pressable key={scenario.key} accessibilityRole="button" onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.heroScenario, pressed && styles.pressed]}><Ionicons name={scenarioIcon(scenario.key)} size={17} color={colors.primary} /><Text numberOfLines={1} style={styles.heroScenarioLabel}>{scenario.label}</Text></Pressable>)}</View>
    </View>
  );
}

function Overview({ domain, plans, activePlans, latest, connections }: { domain: string; plans: PlanSummary[]; activePlans: number; latest: PlanSummary['latestExecution']; connections: ConnectionSummary[] }) {
  const scenarios = scenariosForDomain(domain);
  return (
    <>
      <SectionHeading title="连接的来源" action="添加连接" onPress={() => router.push('/connections/add' as never)} />
      <View style={styles.listCard}>{connections.length > 0 ? connections.slice(0, 3).map((item, index) => <View key={item.id} style={[styles.sourceRow, index < Math.min(connections.length, 3) - 1 && styles.rowDivider]}><View style={styles.sourceIcon}><Ionicons name={connectionIcon(item.connectorId)} size={19} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.connectorName}</Text><Text numberOfLines={1} style={styles.rowDetail}>{item.externalAccountName}</Text></View><View style={styles.statusDot} /><Text style={styles.connectedText}>已连接</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></View>) : <Pressable onPress={() => router.push('/connections/add' as never)} style={styles.emptySource}><Ionicons name="add-circle-outline" size={21} color={colors.primary} /><Text style={styles.emptySourceText}>添加真实来源后，计划才能持续获取信息</Text></Pressable>}</View>

      <SectionHeading title="进行中的计划" count={activePlans} action="查看全部" onPress={() => router.push('/plan-center' as never)} />
      <View style={styles.listCard}>{plans.length > 0 ? plans.slice(0, 3).map((plan, index) => <PlanRow key={plan.id} icon={planVisualIcon(plan.name ?? '', undefined)} name={plan.name ?? plan.currentVersion?.name ?? '我的计划'} description={plan.description ?? '按你的设置持续运行'} detail={planNextRunLabel(plan.status, plan.nextExpectedRunAt)} status={planStatusLabel(plan.status)} statusTone={planStatusTone(plan.status)} onPress={() => router.push(`/plans/${plan.id}` as never)} last={index === Math.min(plans.length, 3) - 1} />) : <Text style={styles.cardEmpty}>还没有运行中的计划。</Text>}</View>

      <SectionHeading title="最近事件" action="查看记录" onPress={() => router.push('/records' as never)} />
      <View style={styles.listCard}>{latest ? <View style={styles.eventRow}><View style={styles.eventIcon}><Ionicons name="checkmark" size={16} color="#FFFFFF" /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{latest.resultSummary ?? planStatusLabel(latest.status)}</Text><Text style={styles.rowDetail}>最近一次运行结果已收进记录</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></View> : <Text style={styles.cardEmpty}>该领域还没有运行记录。</Text>}</View>

      <SectionHeading title="AI 建议" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionRow}>{scenarios.slice(0, 3).map((scenario) => <Pressable key={scenario.key} onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.suggestionCard, pressed && styles.pressed]}><Ionicons name={scenarioIcon(scenario.key)} size={20} color={colors.primary} /><Text style={styles.suggestionTitle}>{scenario.label}计划</Text><Text style={styles.suggestionCopy}>设置条件与提醒，变化时再告诉你</Text><Text style={styles.suggestionAction}>使用建议</Text></Pressable>)}</ScrollView>
      <Pressable accessibilityRole="button" onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}><Ionicons name="add" size={20} color="#FFFFFF" /><Text style={styles.primaryCtaText}>创建这个领域的计划</Text></Pressable>
    </>
  );
}

function SectionHeading({ title, count, action, onPress }: { title: string; count?: number; action?: string; onPress?: () => void }) {
  return <View style={styles.sectionHeading}><View style={styles.sectionHeadingTitle}><Text style={styles.sectionTitleInline}>{title}</Text>{typeof count === 'number' ? <Text style={styles.countBadge}>{count}</Text> : null}</View>{action && onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}><Text style={styles.sectionAction}>{action}  ›</Text></Pressable> : null}</View>;
}

function PlansSection({ plans, label }: { plans: PlanSummary[]; label: string }) {
  if (plans.length === 0) return <Surface><EmptyState icon="add-circle-outline" title={`还没有${label}计划`} description="可以先安排提醒、整理或准备类任务；外部副作用仍会遵循安全等级和确认规则。" action={{ label: '添加计划', onPress: () => router.push('/create' as never) }} /></Surface>;
  return <View style={styles.planList}>{plans.map((plan, index) => <PlanRow key={plan.id} icon={planVisualIcon(plan.name ?? '', undefined)} name={plan.name ?? plan.currentVersion?.name ?? '我的计划'} description={plan.description ?? plan.latestExecution?.resultSummary ?? '会持续按你的设置帮你留意。'} detail={planNextRunLabel(plan.status, plan.nextExpectedRunAt)} status={plan.hasMissingConnection ? '还差一步' : planStatusLabel(plan.status)} statusTone={plan.hasMissingConnection ? 'warning' : planStatusTone(plan.status)} onPress={() => router.push(`/plans/${plan.id}` as never)} last={index === plans.length - 1} />)}</View>;
}

function ResourcesSection({ domain }: { domain: string }) {
  const resourceRoute = domain === 'vehicle' ? '/vehicles' : domain === 'device' ? '/devices' : null;
  return <View style={styles.sectionBody}><Text style={styles.activityTitle}>我的资料</Text><Text style={styles.activityDetail}>{resourceRoute ? '这里会显示已记录的真实资源；它们目前仍以手工资料或已授权连接为准。' : '该领域的资源连接仍在逐步接入。没有已授权来源时，不会伪装成实时数据。'}</Text>{resourceRoute ? <View style={styles.action}><Pressable accessibilityRole="button" onPress={() => router.push(resourceRoute as never)}><Text style={styles.actionText}>查看我的资料</Text></Pressable></View> : <View style={styles.action}><Pressable accessibilityRole="button" onPress={() => router.push('/connections/add' as never)}><Text style={styles.actionText}>添加连接</Text></Pressable></View>}</View>;
}

function ActivitySection({ plans }: { plans: PlanSummary[] }) {
  const activities = plans.filter((plan) => plan.latestExecution).map((plan) => ({ id: plan.id, name: plan.name ?? plan.currentVersion?.name ?? '我的计划', detail: plan.latestExecution?.resultSummary ?? planStatusLabel(plan.latestExecution?.status ?? plan.status) }));
  if (activities.length === 0) return <Surface><Text style={styles.quietText}>还没有可显示的动态。计划运行后，结果会在这里和记录中保留。</Text></Surface>;
  return <View style={styles.activityList}>{activities.map((item, index) => <Pressable accessibilityRole="button" key={item.id} onPress={() => router.push(`/plans/${item.id}` as never)} style={[styles.activityRow, index < activities.length - 1 && styles.activityDivider]}><View style={styles.activityDot} /><View style={styles.activityCopy}><Text style={styles.activityTitle}>{item.name}</Text><Text style={styles.activityDetail}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}</View>;
}

type IconName = ComponentProps<typeof Ionicons>['name'];

function domainIcon(domain: string): IconName {
  return ({
    finance: 'wallet-outline', daily_life: 'basket-outline', life: 'basket-outline', family: 'people-outline', health: 'heart-outline', social: 'chatbubbles-outline',
    pet: 'paw-outline', housing: 'home-outline', travel: 'airplane-outline', entertainment: 'game-controller-outline', work: 'briefcase-outline', operations: 'analytics-outline',
    content: 'create-outline', study: 'school-outline', identity_docs: 'id-card-outline', government: 'business-outline', legal_contract: 'document-text-outline', vehicle: 'car-outline',
    device: 'desktop-outline', digital_account: 'key-outline',
  } as Record<string, IconName>)[domain] ?? 'grid-outline';
}

function scenarioIcon(scenario: string): IconName {
  return ({
    bill: 'receipt-outline', budget: 'pie-chart-outline', balance: 'layers-outline', subscription: 'calendar-outline', refund: 'refresh-outline', abnormal_transaction: 'warning-outline',
    maintenance: 'construct-outline', insurance: 'shield-checkmark-outline', inspection: 'search-outline', energy: 'flash-outline', abnormal: 'warning-outline', daily: 'calendar-outline',
  } as Record<string, IconName>)[scenario] ?? 'checkmark-circle-outline';
}

function connectionIcon(connectorId: string): IconName {
  return ({ gmail: 'mail-outline', google_calendar: 'calendar-outline', calendar: 'calendar-outline', github: 'logo-github', file_provider: 'document-text-outline' } as Record<string, IconName>)[connectorId] ?? 'link-outline';
}

function domainDescription(domain: string) {
  return ({
    finance: '管理收支、预算、订阅与资产，让财务生活更清晰简单。',
    daily_life: '把缴费、预约、快递和日常待办安静地管理起来。',
    family: '汇总家庭成员、分工和共享资源，让重要事项不遗漏。',
    health: '持续关注用药、复诊、体检和健康趋势。',
    vehicle: '把保养、保险、年检和车辆异常放在一起管理。',
    device: '管理设备状态、耗材、维护、续费和异常。',
    digital_account: '守护登录、授权、订阅与账户容量。',
  } as Record<string, string>)[domain] ?? '把这个领域的来源、计划与结果放在一起管理。';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  invalid: { flex: 1, padding: spacing.page, justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: '#F2F3F5', padding: 3, borderRadius: radius.md, marginTop: spacing.md, marginBottom: spacing.lg },
  tab: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabSelected: { backgroundColor: colors.surface },
  tabText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  tabTextSelected: { color: colors.primary, fontWeight: '800' },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  domainHero: { paddingTop: spacing.lg },
  heroHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, minWidth: 0 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroTitle: { ...typography.title, color: colors.text, fontSize: 22, lineHeight: 28 },
  enabledBadge: { ...typography.label, color: colors.primary, backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  heroDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  heroScenarioGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radius.md, overflow: 'hidden' },
  heroScenario: { width: '33.333%', minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  heroScenarioLabel: { ...typography.caption, color: colors.text, fontWeight: '700', flexShrink: 1 },
  sectionHeading: { minHeight: 38, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeadingTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitleInline: { ...typography.section, color: colors.text },
  countBadge: { ...typography.label, color: colors.textSecondary, backgroundColor: '#F1F4F3', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  sectionAction: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  listCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  sourceRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  sourceIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  connectedText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  emptySource: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  emptySourceText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  cardEmpty: { ...typography.caption, color: colors.textSecondary, padding: spacing.lg },
  eventRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  eventIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  suggestionRow: { gap: spacing.sm, paddingRight: spacing.lg },
  suggestionCard: { width: 150, minHeight: 124, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#FFFFFF', padding: spacing.md },
  suggestionTitle: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.sm },
  suggestionCopy: { ...typography.caption, color: colors.textSecondary, marginTop: 3, flex: 1 },
  suggestionAction: { ...typography.label, color: colors.primary, marginTop: spacing.sm },
  primaryCta: { minHeight: 48, marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  primaryCtaText: { ...typography.bodyStrong, color: '#FFFFFF' },
  sectionBody: { paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityTitle: { ...typography.bodyStrong, color: colors.text },
  activityDetail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 19 },
  quietText: { ...typography.body, color: colors.textSecondary },
  action: { marginTop: spacing.lg, alignItems: 'flex-start' },
  actionText: { ...typography.bodyStrong, color: colors.primary },
  planList: { gap: 0 },
  activityList: { padding: 0, overflow: 'hidden' },
  activityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  activityDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activityCopy: { flex: 1 },
  pressed: { backgroundColor: colors.pressed },
});
