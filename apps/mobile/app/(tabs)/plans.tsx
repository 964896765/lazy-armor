import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { AnimatedEntry, EmptyState, PlanCard, Surface, colors, spacing, typography } from '../../src/design';
import {
  consumerPlanGroup,
  consumerPlanGroupSubtitle,
  planCenterStatusLabel,
  planNextRunLabel,
  planStatusLabel,
  planStatusTone,
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
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
  currentVersion: { versionNumber: number; name: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device';
    currentStatus: string;
  } | null;
}

const consumerGroups: ConsumerPlanGroup[] = ['我的生活', '我的钱', '我的事情', '我的东西', '其他计划'];

export default function Plans() {
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['plans', token],
    queryFn: () => api<PlanSummary[]>('/plans', token),
    enabled: Boolean(token),
  });
  const activeCount = (plans.data ?? []).filter((plan) => plan.status === 'active' || plan.status === 'ready').length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>我的懒人计划</Text>
          <Text style={styles.subtitle}>{activeCount > 0 ? `正在帮你处理 ${activeCount} 件事` : '把麻烦交给我，生活可以轻一点。'}</Text>
        </View>

        {!token ? (
          <Surface><EmptyState icon="🛡️" title="登录后查看你的计划" description="已经安排的事情都会在这里。" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface>
        ) : null}
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理你的计划…</Text></View> : null}
        {plans.isError ? <Surface><EmptyState icon="☁️" title="暂时没能读取计划" description="请稍后再试。" action={{ label: '重新加载', onPress: () => plans.refetch() }} /></Surface> : null}
        {plans.data?.length === 0 ? (
          <Surface><EmptyState icon="✨" title="还没有让懒人装甲帮你处理的事情" suggestion="帮我管理我的快递" action={{ label: '安排第一件事', onPress: () => router.push('/create') }} /></Surface>
        ) : null}

        {consumerGroups.map((group, groupIndex) => {
          const items = (plans.data ?? []).filter((plan) => consumerPlanGroup({
            consumerGroup: plan.consumerGroup ?? null,
            templateKey: plan.templateKey,
            planCenterKind: plan.planCenterSummary?.kind ?? null,
          }) === group);
          if (items.length === 0) return null;
          return (
            <AnimatedEntry key={group} delay={groupIndex * 50}>
              <View style={styles.group}>
                <Text style={styles.groupTitle}>{group}</Text>
                <Text style={styles.groupSubtitle}>{consumerPlanGroupSubtitle(group)}</Text>
                <View style={styles.cardList}>
                  {items.map((plan) => {
                    const name = plan.name ?? plan.currentVersion?.name ?? '我的懒人计划';
                    return (
                      <PlanCard
                        key={plan.id}
                        icon={planVisualIcon(name, plan.planCenterSummary?.kind)}
                        name={name}
                        description={planDescription(plan)}
                        status={plan.hasMissingConnection ? '还差一步设置' : planStatusLabel(plan.status)}
                        statusTone={plan.hasMissingConnection ? 'warning' : planStatusTone(plan.status)}
                        nextRun={planNextRunLabel(plan.status, plan.nextExpectedRunAt)}
                        onPress={() => router.push(`/plans/${plan.id}` as never)}
                      />
                    );
                  })}
                </View>
              </View>
            </AnimatedEntry>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function planDescription(plan: PlanSummary) {
  if (plan.planCenterSummary) {
    return planCenterStatusLabel(plan.planCenterSummary.kind, plan.planCenterSummary.currentStatus);
  }
  if (plan.description) return plan.description;
  if (plan.latestExecution?.resultSummary) return plan.latestExecution.resultSummary;
  return '会按你的安排持续帮你留意。';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 112 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  loading: { paddingVertical: 64, alignItems: 'center', gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  group: { marginTop: spacing.xxl },
  groupTitle: { ...typography.section, color: colors.text },
  groupSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  cardList: { gap: spacing.md },
});
