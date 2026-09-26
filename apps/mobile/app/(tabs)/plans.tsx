import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { AnimatedEntry, PlanRow, WorkspaceHeader, WorkspaceSection, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import {
  consumerPlanGroup,
  consumerPlanGroupLabel,
  consumerPlanGroupSubtitle,
  consumerPlanStatusLabel,
  consumerPlanStatusTone,
  planCenterStatusLabel,
  planDomainLabel,
  planExceptionReason,
  planNextRunLabel,
  planVisualIcon,
  type ConsumerPlanGroup,
} from '../../src/plan-presenter';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  templateKey: string | null;
  consumerGroup?: string | null;
  templateVersion: string | null;
  domain: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
  currentVersion: { versionNumber: number; name: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device';
    currentStatus: string;
    isException?: boolean;
    latestEventSummary?: string | null;
  } | null;
}

const consumerGroups: ConsumerPlanGroup[] = ['life', 'property', 'affairs', 'work', '其他'];

export default function Plans() {
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['plans', token],
    queryFn: () => api<PlanSummary[]>('/plans', token),
    enabled: Boolean(token),
  });
  const activeCount = (plans.data ?? []).filter((plan) => plan.status === 'active' || plan.status === 'ready').length;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
      >
        <WorkspaceHeader
          title="工作区"
          subtitle={activeCount > 0 ? `${activeCount} 个计划在帮你照看生活` : '从一个场景开始安排生活'}
        />

        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="sparkles-outline" size={24} color={colors.primary} /></View>
          <View style={styles.heroCopy}><Text style={styles.heroTitle}>你关心的事，交给计划持续跟进</Text><Text style={styles.heroDescription}>从真实场景出发，查看已有计划或安排新事项。</Text></View>
        </View>

        <Text style={styles.spaceHeading}>我的空间</Text>
        <View style={styles.spaceGrid}>
          {consumerGroups.slice(0, 4).map((group, index) => <Pressable key={group} accessibilityRole="button" onPress={() => router.push(`/domains?group=${(['life', 'property', 'affairs', 'work'] as const)[index]}` as never)} style={({ pressed }) => [styles.spaceCard, pressed && styles.pressed]}><View style={[styles.spaceIcon, index === 1 && styles.spaceIconLife, index === 2 && styles.spaceIconWork, index === 3 && styles.spaceIconThings]}><Ionicons name={(['home-outline', 'wallet-outline', 'document-text-outline', 'briefcase-outline'] as const)[index]} size={20} color={colors.primary} /></View><Text style={styles.spaceLabel}>{consumerPlanGroupLabel(group)}</Text><Text style={styles.spaceCount}>{plans.data ? `${plans.data.filter((plan) => consumerPlanGroup({ consumerGroup: plan.consumerGroup ?? null, domain: plan.domain, templateKey: plan.templateKey, planCenterKind: plan.planCenterSummary?.kind ?? null }) === group).length} 个计划` : '计划数待同步'}</Text></Pressable>)}
        </View>

        <View style={styles.tools}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/plan-center' as never)} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}><Ionicons name="list-circle-outline" size={18} color={colors.primary} /><Text style={styles.toolText}>计划中心</Text></Pressable>
          <View style={styles.toolDivider} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/domains' as never)} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}><Ionicons name="grid-outline" size={17} color={colors.primary} /><Text style={styles.toolText}>浏览场景</Text></Pressable>
          <View style={styles.toolDivider} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/records' as never)} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}><Ionicons name="list-outline" size={18} color={colors.primary} /><Text style={styles.toolText}>查看记录</Text></Pressable>
        </View>

        {!token ? (
          <InlineState icon="shield-checkmark-outline" title="登录后查看计划" description="已经安排的事情都会在这里。" action="去登录" onPress={() => router.push('/auth/login' as never)} />
        ) : null}
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在同步计划…</Text></View> : null}
        {plans.isError ? <InlineState icon="refresh-outline" title="暂时没能读取计划" description="网络恢复后可重新加载。" action="重试" onPress={() => plans.refetch()} /> : null}
        {plans.data?.length === 0 ? (
          <View style={styles.emptyPlan}>
            <View style={styles.emptyIcon}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /></View>
            <View style={styles.emptyCopy}><Text style={styles.emptyTitle}>还没有计划</Text><Text style={styles.emptyDescription}>试试“帮我管理我的快递”</Text></View>
            <Pressable accessibilityRole="button" onPress={() => router.push('/create')} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}><Text style={styles.emptyActionText}>安排</Text></Pressable>
          </View>
        ) : null}

        {consumerGroups.map((group, groupIndex) => {
          const items = (plans.data ?? []).filter((plan) => consumerPlanGroup({
            consumerGroup: plan.consumerGroup ?? null,
            domain: plan.domain,
            templateKey: plan.templateKey,
            planCenterKind: plan.planCenterSummary?.kind ?? null,
          }) === group);
          if (items.length === 0) return null;
          return (
            <AnimatedEntry key={group} delay={groupIndex * 40}>
              <WorkspaceSection title={consumerPlanGroupLabel(group)} count={items.length}>
                <Text style={styles.groupSubtitle}>{consumerPlanGroupSubtitle(group)}</Text>
                <View style={styles.planGroup}>
                  {items.map((plan, index) => {
                    const name = plan.name ?? plan.currentVersion?.name ?? '我的懒人计划';
                    return (
                      <PlanRow
                        key={plan.id}
                        icon={planVisualIcon(name, plan.planCenterSummary?.kind)}
                        name={name}
                        description={planDescription(plan)}
                        detail={`${planDomainLabel(plan.domain)} · ${planNextRunLabel(plan.status, plan.nextExpectedRunAt)}`}
                        status={consumerPlanStatusLabel({ status: plan.status, hasMissingConnection: plan.hasMissingConnection })}
                        statusTone={consumerPlanStatusTone({ status: plan.status, hasMissingConnection: plan.hasMissingConnection })}
                        onPress={() => router.push(`/plans/${plan.id}` as never)}
                        last={index === items.length - 1}
                      />
                    );
                  })}
                </View>
              </WorkspaceSection>
            </AnimatedEntry>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function InlineState({ icon, title, description, action, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; description: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineIcon}><Ionicons name={icon} size={19} color={colors.primary} /></View><View style={styles.inlineCopy}><Text style={styles.inlineTitle}>{title}</Text><Text style={styles.inlineDescription}>{description}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>;
}

function planDescription(plan: PlanSummary) {
  const exception = planExceptionReason(plan);
  if (exception) return exception;
  if (plan.planCenterSummary) return planCenterStatusLabel(plan.planCenterSummary.kind, plan.planCenterSummary.currentStatus);
  if (plan.description) return plan.description;
  if (plan.latestExecution?.resultSummary) return plan.latestExecution.resultSummary;
  return '会按你的安排持续帮你留意。';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  pressed: { opacity: 0.65 },
  hero: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginTop: spacing.sm, borderRadius: radius.lg, backgroundColor: '#FFF1E5' },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heroCopy: { flex: 1 },
  heroTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 16, lineHeight: 23 },
  heroDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 4 },
  spaceHeading: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  spaceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
  spaceCard: { width: '48.5%', minHeight: 118, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  spaceIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accentSoft },
  spaceIconLife: { backgroundColor: colors.successSoft },
  spaceIconWork: { backgroundColor: '#EAF2FF' },
  spaceIconThings: { backgroundColor: '#F1EBFF' },
  spaceLabel: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.sm },
  spaceCount: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tools: { minHeight: 50, flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#E3E5E8' },
  tool: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  toolDivider: { width: 1, height: 24, backgroundColor: '#EAECF0' },
  toolText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  inlineState: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  inlineCopy: { flex: 1, minWidth: 0 },
  inlineTitle: { ...typography.bodyStrong, color: colors.text },
  inlineDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  inlineAction: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { ...typography.label, color: colors.surface },
  emptyPlan: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  emptyIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  emptyAction: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  loading: { paddingVertical: 64, alignItems: 'center', gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  groupSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  planGroup: { backgroundColor: colors.surface, paddingHorizontal: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
});
