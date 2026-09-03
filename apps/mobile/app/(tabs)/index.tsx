import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import {
  ActionButton,
  AnimatedEntry,
  AttentionCard,
  EmptyState,
  PlanCard,
  Surface,
  TodayCard,
  colors,
  spacing,
  typography,
} from '../../src/design';
import { connectionRecoveryAction, connectionStatusExplanation, connectionStatusLabel, connectionStatusNextStep, consumerErrorMessage, consumerErrorNextStep } from '../../src/connection-presenter';
import { executionStatusLabel } from '../../src/execution-presenter';
import { approvalRiskText, todayState } from '../../src/today-presenter';

interface ApprovalCard { id: string; executionId: string; riskLevel: string; summary: string; expiresAt: string; planName: string }
interface AlertCard { id: string; priority: string; title: string; body: string; executionId?: string; createdAt: string; category?: 'attention' | 'exception' | 'summary' }
interface ProcessedCard { id: string; status: string; resultSummary: string | null; finishedAt: string | null; planName: string; planVersionNumber: number }
interface ConnectionIssue { connectionId: string; connectionStatus: string; providerKey: string; providerName: string; planId: string; planName: string }
interface TodayData { pendingApprovals: ApprovalCard[]; connectionIssues: ConnectionIssue[]; alerts: AlertCard[]; processed: ProcessedCard[] }
interface Profile { displayName: string }
interface PresentableAlert extends AlertCard { section: 'attention' | 'exception' | 'summary' }

export default function Today() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const today = useQuery({
    queryKey: ['today', token],
    queryFn: () => api<TodayData>('/today', token),
    enabled: Boolean(token),
    refetchInterval: 5000,
  });
  const profile = useQuery({
    queryKey: ['me', token],
    queryFn: () => api<Profile>('/me', token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision, risk }: { id: string; decision: 'approve' | 'reject'; risk: string }) => api(`/approvals/${id}/${decision}`, token, {
      method: 'POST',
      body: JSON.stringify(decision === 'approve' && risk === 'R4' ? { confirmation: 'APPROVE_R4', deviceId: 'mobile' } : { deviceId: 'mobile' }),
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['today', token] }); },
  });

  const alerts = (today.data?.alerts ?? []).map((item) => ({ ...item, section: classifyAlert(item) })) satisfies PresentableAlert[];
  const attentionAlerts = alerts.filter((item) => item.section === 'attention');
  const exceptionAlerts = alerts.filter((item) => item.section === 'exception');
  const summaryAlerts = alerts.filter((item) => item.section === 'summary');
  const attentionCount = (today.data?.pendingApprovals.length ?? 0)
    + (today.data?.connectionIssues.length ?? 0)
    + attentionAlerts.length
    + exceptionAlerts.length;
  const totalCount = attentionCount + summaryAlerts.length + (today.data?.processed.length ?? 0);
  const state = todayState(Boolean(token), today.isLoading, today.isError, totalCount);
  const completedItems = [
    ...(today.data?.processed ?? []).map((item) => item.resultSummary ? `${item.planName}：${item.resultSummary}` : `${item.planName}已完成`),
    ...summaryAlerts.map((item) => `${item.title}：${consumerErrorMessage(item.body)}`),
  ].slice(0, 4);

  const confirm = (approval: ApprovalCard, decision: 'approve' | 'reject') => Alert.alert(
    decision === 'approve' ? '确认继续？' : '确认拒绝？',
    approval.summary,
    [
      { text: '返回', style: 'cancel' },
      { text: decision === 'approve' ? '确认继续' : '拒绝', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => decide.mutate({ id: approval.id, decision, risk: approval.riskLevel }) },
    ],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={today.isFetching} onRefresh={() => today.refetch()} /> : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>{greetingText(profile.data?.displayName)}</Text>
          <Text style={styles.date}>今天 · {formatToday()}</Text>
          <Text style={styles.intro}>懒人装甲已经在帮你关注生活里的大小事。</Text>
        </View>

        {state === 'signed_out' ? (
          <Surface><EmptyState icon="🛡️" title="登录后，我就能开始帮你" description="你的计划、提醒和完成结果都会集中在这里。" action={{ label: '开始使用', onPress: () => router.push('/connections') }} /></Surface>
        ) : null}

        {state === 'loading' ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在看看今天的安排…</Text></View>
        ) : null}

        {state === 'error' ? (
          <Surface><EmptyState icon="☁️" title="网络暂时不可用" description="没有关系，稍后再试就好。" action={{ label: '重新加载', onPress: () => today.refetch() }} /></Surface>
        ) : null}

        {state === 'empty' ? (
          <>
            <AnimatedEntry><StatusCard attentionCount={0} /></AnimatedEntry>
            <View style={styles.sectionBlock}>
              <SectionTitle title="今天已经帮你" />
              <Surface><EmptyState title="今天一切安静" description="目前没有需要你处理的事情，我会继续留意。" /></Surface>
            </View>
          </>
        ) : null}

        {state === 'ready' ? (
          <>
            <AnimatedEntry><StatusCard attentionCount={attentionCount} /></AnimatedEntry>

            <AnimatedEntry delay={60}>
              <View style={styles.sectionBlock}>
                <SectionTitle title="已帮你完成" />
                {completedItems.length > 0
                  ? <TodayCard items={completedItems} footnote="完成的事情已经收进记录，随时可以回看。" />
                  : <Surface><Text style={styles.quietText}>暂时还没有新的完成结果，我会继续安静地留意。</Text></Surface>}
              </View>
            </AnimatedEntry>

            {attentionCount > 0 ? (
              <AnimatedEntry delay={120}>
                <View style={styles.sectionBlock}>
                  <SectionTitle title="需要你处理" count={attentionCount} />
                  <View style={styles.cardList}>
                    {today.data?.pendingApprovals.map((item) => (
                      <AttentionCard
                        key={item.id}
                        title={item.planName}
                        description={item.summary}
                        detail={`${approvalRiskText(item.riskLevel)} · ${formatExpiry(item.expiresAt)}`}
                        actionLabel="确认继续"
                        onPress={() => confirm(item, 'approve')}
                        secondaryAction={{ label: '暂不处理', onPress: () => confirm(item, 'reject') }}
                      />
                    ))}
                    {today.data?.connectionIssues.map((item) => (
                      <AttentionCard
                        key={`${item.planId}:${item.connectionId}`}
                        title={`${item.providerName}${connectionStatusLabel(item.connectionStatus)}`}
                        description={`${connectionStatusExplanation(item.connectionStatus)} “${item.planName}”会保留当前设置。`}
                        detail={connectionStatusNextStep(item.connectionStatus)}
                        actionLabel={connectionRecoveryAction(item.connectionStatus) ?? '查看连接'}
                        onPress={() => router.push('/connections')}
                      />
                    ))}
                    {[...attentionAlerts, ...exceptionAlerts].map((item) => (
                      <AttentionCard
                        key={item.id}
                        title={item.title}
                        description={consumerErrorMessage(item.body)}
                        detail={consumerErrorNextStep(item.body)}
                        actionLabel="查看"
                        onPress={item.executionId ? () => router.push(`/executions/${item.executionId}` as never) : undefined}
                      />
                    ))}
                  </View>
                </View>
              </AnimatedEntry>
            ) : null}

            {(today.data?.processed.length ?? 0) > 0 ? (
              <AnimatedEntry delay={180}>
                <View style={styles.sectionBlock}>
                  <SectionTitle title="最近运行的计划" action={{ label: '全部记录', onPress: () => router.push('/records') }} />
                  <View style={styles.cardList}>
                    {today.data?.processed.slice(0, 3).map((item) => (
                      <PlanCard
                        key={item.id}
                        icon={planIcon(item.planName)}
                        name={item.planName}
                        description={item.resultSummary ?? executionStatusLabel(item.status)}
                        status={executionStatusLabel(item.status)}
                        nextRun={formatFinishedAt(item.finishedAt)}
                        onPress={() => router.push(`/executions/${item.id}` as never)}
                      />
                    ))}
                  </View>
                </View>
              </AnimatedEntry>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusCard({ attentionCount }: { attentionCount: number }) {
  const needsAttention = attentionCount > 0;
  return (
    <Surface style={[styles.statusCard, needsAttention ? styles.statusWarning : styles.statusSuccess]}>
      <View style={[styles.statusIcon, needsAttention ? styles.statusIconWarning : styles.statusIconSuccess]}>
        <Text style={styles.statusEmoji}>{needsAttention ? '!' : '✓'}</Text>
      </View>
      <View style={styles.statusCopy}>
        <Text style={styles.statusEyebrow}>今日状态</Text>
        <Text style={styles.statusTitle}>{needsAttention ? `有 ${attentionCount} 件事情需要你看看` : '今天一切正常'}</Text>
        <Text style={styles.statusDescription}>{needsAttention ? '其余计划仍在照常帮你运行。' : '没有需要你处理的事情。'}</Text>
      </View>
    </Surface>
  );
}

function SectionTitle({ title, count, action }: { title: string; count?: number; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count ? <View style={styles.countBadge}><Text style={styles.countText}>{count}</Text></View> : null}
      </View>
      {action ? <ActionButton label={action.label} tone="quiet" onPress={action.onPress} /> : null}
    </View>
  );
}

function classifyAlert(item: AlertCard): PresentableAlert['section'] {
  if (item.category) return item.category;
  const normalized = `${item.title} ${item.body}`.toLowerCase();
  if (item.priority === 'P0' || normalized.includes('需要你') || normalized.includes('等待你') || normalized.includes('重新连接') || normalized.includes('重新授权') || normalized.includes('确认')) return 'attention';
  if (item.priority === 'P2' || normalized.includes('摘要') || normalized.includes('重点')) return 'summary';
  return 'exception';
}

function greetingText(displayName?: string) {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return displayName ? `${greeting}，${displayName}` : greeting;
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

function formatExpiry(value: string) {
  return `${new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效`;
}

function formatFinishedAt(value: string | null) {
  if (!value) return '结果已收进记录';
  return `今天 ${new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function planIcon(name: string) {
  if (name.includes('邮件') || name.includes('摘要')) return '✉️';
  if (name.includes('快递') || name.includes('包裹')) return '📦';
  if (name.includes('设备') || name.includes('打印机')) return '🖨️';
  if (name.includes('账单') || name.includes('钱')) return '💰';
  if (name.includes('车辆') || name.includes('保养')) return '🚙';
  return '🛡️';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 112 },
  header: { marginBottom: spacing.xxl },
  greeting: { ...typography.display, color: colors.text },
  date: { ...typography.bodyStrong, color: colors.primary, marginTop: spacing.sm },
  intro: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md, maxWidth: 310 },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  statusSuccess: { backgroundColor: colors.successSoft, borderColor: '#CFE1D7' },
  statusWarning: { backgroundColor: colors.warningSoft, borderColor: '#EDD1A8' },
  statusIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  statusIconSuccess: { backgroundColor: colors.success },
  statusIconWarning: { backgroundColor: colors.warning },
  statusEmoji: { color: colors.surface, fontSize: 20, fontWeight: '800' },
  statusCopy: { flex: 1 },
  statusEyebrow: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  statusTitle: { ...typography.cardTitle, color: colors.text },
  statusDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sectionBlock: { marginTop: spacing.xxxl },
  sectionHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { ...typography.section, color: colors.text },
  countBadge: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: colors.warningSoft, alignItems: 'center', justifyContent: 'center' },
  countText: { ...typography.label, color: colors.warning },
  cardList: { gap: spacing.md },
  quietText: { ...typography.body, color: colors.textSecondary },
});
