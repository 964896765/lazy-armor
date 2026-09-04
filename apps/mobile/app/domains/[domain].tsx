import { useQuery } from '@tanstack/react-query';
import { canonicalPlanDomain, domainDefinition } from '@lazy-armor/plan-schema/mobile';
import { useLocalSearchParams, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, PlanCard, Surface, colors, radius, spacing, typography } from '../../src/design';
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
  const domainPlans = useMemo(() => (plans.data ?? []).filter((plan) => canonicalPlanDomain(plan.domain) === definition?.key), [plans.data, definition?.key]);
  const activePlans = domainPlans.filter((plan) => plan.status === 'active' || plan.status === 'ready');
  const latest = [...domainPlans].sort((left, right) => (right.latestExecution?.createdAt ?? '').localeCompare(left.latestExecution?.createdAt ?? ''))[0]?.latestExecution ?? null;

  if (!definition) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.invalid}><EmptyState icon="?" title="未找到这个领域" description="请从“我的领域”中选择要查看的生活空间。" action={{ label: '查看领域目录', onPress: () => router.replace('/domains' as never) }} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{groupLabel(definition.group)}</Text>
          <Text style={styles.title}>{definition.label}</Text>
          <Text style={styles.subtitle}>计划、资料与最近动态都会集中在这里。手工、离线或待接入状态会如实标注。</Text>
        </View>
        <View style={styles.tabs}>{TABS.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setTab(item)} style={[styles.tab, item === tab && styles.tabSelected]}><Text style={[styles.tabText, item === tab && styles.tabTextSelected]}>{item}</Text></Pressable>)}</View>
        {!token ? <Surface><EmptyState icon="◆" title="登录后查看你的领域" description="只有你本人可查看与管理自己的计划和资料。" action={{ label: '去登录', onPress: () => router.push('/auth/login') }} /></Surface> : null}
        {token && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在读取{definition.label}…</Text></View> : null}
        {token && !plans.isLoading && tab === '概览' ? <Overview activePlans={activePlans.length} planCount={domainPlans.length} latest={latest} /> : null}
        {token && !plans.isLoading && tab === '计划' ? <PlansSection plans={domainPlans} label={definition.label} /> : null}
        {token && !plans.isLoading && tab === '资料' ? <ResourcesSection domain={definition.key} /> : null}
        {token && !plans.isLoading && tab === '动态' ? <ActivitySection plans={domainPlans} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Overview({ activePlans, planCount, latest }: { activePlans: number; planCount: number; latest: PlanSummary['latestExecution'] }) {
  return (
    <>
      <View style={styles.statGrid}>
        <Surface style={styles.statCard}><Text style={styles.statValue}>{activePlans}</Text><Text style={styles.statLabel}>正在帮你</Text></Surface>
        <Surface style={styles.statCard}><Text style={styles.statValue}>{planCount}</Text><Text style={styles.statLabel}>已设置计划</Text></Surface>
      </View>
      <Text style={styles.sectionTitle}>最近动态</Text>
      <Surface>{latest ? <><Text style={styles.activityTitle}>{latest.resultSummary ?? planStatusLabel(latest.status)}</Text><Text style={styles.activityDetail}>最近一次运行结果已收进记录。</Text></> : <Text style={styles.quietText}>该领域还没有运行记录。你可以先添加一项计划，或连接一个可用的信息来源。</Text>}</Surface>
      <Text style={styles.sectionTitle}>下一步</Text>
      <Surface><Text style={styles.activityTitle}>从一件小事开始</Text><Text style={styles.activityDetail}>选择一个场景后，系统会明确告诉你看什么、何时判断、做到哪一步，以及是否需要确认。</Text><View style={styles.action}><Pressable accessibilityRole="button" onPress={() => router.push('/create' as never)}><Text style={styles.actionText}>添加计划</Text></Pressable></View></Surface>
    </>
  );
}

function PlansSection({ plans, label }: { plans: PlanSummary[]; label: string }) {
  if (plans.length === 0) return <Surface><EmptyState icon="＋" title={`还没有${label}计划`} description="可以先安排提醒、整理或准备类任务；外部副作用仍会遵循安全等级和确认规则。" action={{ label: '添加计划', onPress: () => router.push('/create' as never) }} /></Surface>;
  return <View style={styles.planList}>{plans.map((plan) => <PlanCard key={plan.id} icon={planVisualIcon(plan.name ?? '', undefined)} name={plan.name ?? plan.currentVersion?.name ?? '我的计划'} description={plan.description ?? plan.latestExecution?.resultSummary ?? '会持续按你的设置帮你留意。'} status={plan.hasMissingConnection ? '还差一步设置' : planStatusLabel(plan.status)} statusTone={plan.hasMissingConnection ? 'warning' : planStatusTone(plan.status)} nextRun={planNextRunLabel(plan.status, plan.nextExpectedRunAt)} onPress={() => router.push(`/plans/${plan.id}` as never)} />)}</View>;
}

function ResourcesSection({ domain }: { domain: string }) {
  const resourceRoute = domain === 'vehicle' ? '/vehicles' : domain === 'device' ? '/devices' : null;
  return <Surface><Text style={styles.activityTitle}>我的资料</Text><Text style={styles.activityDetail}>{resourceRoute ? '这里会显示已记录的真实资源；它们目前仍以手工资料或已授权连接为准。' : '该领域的资源连接仍在逐步接入。没有已授权来源时，不会伪装成实时数据。'}</Text>{resourceRoute ? <View style={styles.action}><Pressable accessibilityRole="button" onPress={() => router.push(resourceRoute as never)}><Text style={styles.actionText}>查看我的资料</Text></Pressable></View> : <View style={styles.action}><Pressable accessibilityRole="button" onPress={() => router.push('/connections/add' as never)}><Text style={styles.actionText}>添加连接</Text></Pressable></View>}</Surface>;
}

function ActivitySection({ plans }: { plans: PlanSummary[] }) {
  const activities = plans.filter((plan) => plan.latestExecution).map((plan) => ({ id: plan.id, name: plan.name ?? plan.currentVersion?.name ?? '我的计划', detail: plan.latestExecution?.resultSummary ?? planStatusLabel(plan.latestExecution?.status ?? plan.status) }));
  if (activities.length === 0) return <Surface><Text style={styles.quietText}>还没有可显示的动态。计划运行后，结果会在这里和记录中保留。</Text></Surface>;
  return <Surface style={styles.activityList}>{activities.map((item, index) => <Pressable accessibilityRole="button" key={item.id} onPress={() => router.push(`/plans/${item.id}` as never)} style={[styles.activityRow, index < activities.length - 1 && styles.activityDivider]}><View style={styles.activityDot} /><View style={styles.activityCopy}><Text style={styles.activityTitle}>{item.name}</Text><Text style={styles.activityDetail}>{item.detail}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</Surface>;
}

function groupLabel(group: string) {
  if (group === 'money') return '我的钱';
  if (group === 'life') return '我的生活';
  if (group === 'work') return '我的事情';
  return '我的物品';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 48 },
  invalid: { flex: 1, padding: spacing.page, justifyContent: 'center' },
  header: { marginBottom: spacing.xl },
  eyebrow: { ...typography.label, color: colors.primary, letterSpacing: 1 },
  title: { ...typography.display, color: colors.text, marginTop: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 340 },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9E0', padding: 3, borderRadius: radius.md, marginBottom: spacing.xl },
  tab: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabSelected: { backgroundColor: colors.surface },
  tabText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  tabTextSelected: { color: colors.primary, fontWeight: '800' },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  statGrid: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1 },
  statValue: { ...typography.display, color: colors.primary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xxl, marginBottom: spacing.md },
  activityTitle: { ...typography.bodyStrong, color: colors.text },
  activityDetail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 19 },
  quietText: { ...typography.body, color: colors.textSecondary },
  action: { marginTop: spacing.lg, alignItems: 'flex-start' },
  actionText: { ...typography.bodyStrong, color: colors.primary },
  planList: { gap: spacing.md },
  activityList: { padding: 0, overflow: 'hidden' },
  activityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  activityDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activityCopy: { flex: 1 },
  chevron: { color: colors.textMuted, fontSize: 25, fontWeight: '300' },
});
