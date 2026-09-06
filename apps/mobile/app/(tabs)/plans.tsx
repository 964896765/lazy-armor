import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { AnimatedEntry, PlanRow, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';
import {
  consumerPlanGroup,
  consumerPlanGroupSubtitle,
  planCenterStatusLabel,
  planDomainLabel,
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
  domain: string | null;
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

const consumerGroups: ConsumerPlanGroup[] = ['我的钱', '我的生活', '我的事情', '我的物品', '其他计划'];

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
        <WorkspaceHeader
          title="懒人装甲"
          subtitle={activeCount > 0 ? `${activeCount} 个计划正在运行` : '还没有运行中的计划'}
          action={<Pressable accessibilityRole="button" accessibilityLabel="创建计划" onPress={() => router.push('/create' as never)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Text style={styles.addText}>＋</Text></Pressable>}
        />

        <View style={styles.tools}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/domains' as never)} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}><Text style={styles.toolIcon}>⌘</Text><Text style={styles.toolText}>管理领域</Text></Pressable>
          <View style={styles.toolDivider} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/records' as never)} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}><Text style={styles.toolIcon}>▤</Text><Text style={styles.toolText}>查看记录</Text></Pressable>
        </View>

        {!token ? (
          <InlineState icon="◇" title="登录后查看计划" description="已经安排的事情都会在这里。" action="去登录" onPress={() => router.push('/connections')} />
        ) : null}
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在同步计划…</Text></View> : null}
        {plans.isError ? <InlineState icon="↻" title="暂时没能读取计划" description="网络恢复后可重新加载。" action="重试" onPress={() => plans.refetch()} /> : null}
        {plans.data?.length === 0 ? (
          <View style={styles.emptyPlan}>
            <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✦</Text></View>
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
              <WorkspaceSection title={group} count={items.length}>
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
                        status={plan.hasMissingConnection ? '还差一步' : planStatusLabel(plan.status)}
                        statusTone={plan.hasMissingConnection ? 'warning' : planStatusTone(plan.status)}
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

function InlineState({ icon, title, description, action, onPress }: { icon: string; title: string; description: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineIcon}><Text style={styles.inlineIconText}>{icon}</Text></View><View style={styles.inlineCopy}><Text style={styles.inlineTitle}>{title}</Text><Text style={styles.inlineDescription}>{description}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>;
}

function planDescription(plan: PlanSummary) {
  if (plan.planCenterSummary) return planCenterStatusLabel(plan.planCenterSummary.kind, plan.planCenterSummary.currentStatus);
  if (plan.description) return plan.description;
  if (plan.latestExecution?.resultSummary) return plan.latestExecution.resultSummary;
  return '会按你的安排持续帮你留意。';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  addButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F4F7', borderWidth: 1, borderColor: '#EAECF0' },
  addText: { color: '#344054', fontSize: 22, lineHeight: 24, fontWeight: '400' },
  pressed: { opacity: 0.65 },
  tools: { minHeight: 50, flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#E3E5E8' },
  tool: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  toolDivider: { width: 1, height: 24, backgroundColor: '#EAECF0' },
  toolIcon: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  toolText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  inlineState: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  inlineIconText: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  inlineCopy: { flex: 1, minWidth: 0 },
  inlineTitle: { ...typography.bodyStrong, color: colors.text },
  inlineDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  inlineAction: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { ...typography.label, color: colors.surface },
  emptyPlan: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, paddingHorizontal: spacing.xs },
  emptyIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  emptyIconText: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { ...typography.bodyStrong, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  emptyAction: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  loading: { paddingVertical: 64, alignItems: 'center', gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  groupSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  planGroup: { backgroundColor: '#FFFFFF' },
});
