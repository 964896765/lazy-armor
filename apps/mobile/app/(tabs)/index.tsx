import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import {
  AttentionCard,
  MessageRow,
  WorkspaceHeader,
  WorkspaceSection,
  colors,
  radius,
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
interface PendingNotificationCandidate { id: string; candidateResource: string | null; candidateConfidence: number; amountMinor: number | null; currency: string | null; postedAt: string }
interface PresentableAlert extends AlertCard { section: 'attention' | 'exception' | 'summary' }
interface AttentionMessage { id: string; icon: string; title: string; description: string; meta?: string; tone: 'warning' | 'danger' | 'brand'; onPress: () => void }

export default function Today() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const today = useQuery({
    queryKey: ['today', token],
    queryFn: () => api<TodayData>('/today', token),
    enabled: Boolean(token),
    refetchInterval: 5000,
  });
  const pendingNotificationCandidates = useQuery({
    queryKey: ['rail-pending-notification-receipts', token],
    queryFn: () => api<PendingNotificationCandidate[]>('/device-app-connections/notification-receipts', token),
    enabled: Boolean(token),
    refetchInterval: 20_000,
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
    + (pendingNotificationCandidates.data?.length ?? 0)
    + attentionAlerts.length
    + exceptionAlerts.length;
  const totalCount = attentionCount + summaryAlerts.length + (today.data?.processed.length ?? 0);
  const state = todayState(Boolean(token), today.isLoading, today.isError, totalCount);

  const confirm = (approval: ApprovalCard, decision: 'approve' | 'reject') => Alert.alert(
    decision === 'approve' ? '确认继续？' : '确认拒绝？',
    approval.summary,
    [
      { text: '返回', style: 'cancel' },
      { text: decision === 'approve' ? '确认继续' : '拒绝', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => decide.mutate({ id: approval.id, decision, risk: approval.riskLevel }) },
    ],
  );

  const attentionMessages: AttentionMessage[] = [
    ...(today.data?.connectionIssues ?? []).map((item) => ({
      id: `connection:${item.planId}:${item.connectionId}`,
      icon: '↻',
      title: `${item.providerName}${connectionStatusLabel(item.connectionStatus)}`,
      description: `${connectionStatusExplanation(item.connectionStatus)}“${item.planName}”会保留当前设置。${connectionStatusNextStep(item.connectionStatus)}`,
      tone: 'warning' as const,
      onPress: () => router.push('/connections'),
    })),
    ...(pendingNotificationCandidates.data ?? []).map((item) => ({
      id: `notification:${item.id}`,
      icon: '🔔',
      title: '应用通知等待核实',
      description: notificationCandidateSummary(item),
      meta: formatMessageTime(item.postedAt),
      tone: 'brand' as const,
      onPress: () => router.push('/connections/notification-sources' as never),
    })),
    ...[...attentionAlerts, ...exceptionAlerts].map((item) => ({
      id: `alert:${item.id}`,
      icon: item.section === 'exception' ? '!' : '·',
      title: item.title,
      description: `${consumerErrorMessage(item.body)} ${consumerErrorNextStep(item.body)}`.trim(),
      meta: formatMessageTime(item.createdAt),
      tone: item.section === 'exception' ? 'danger' as const : 'warning' as const,
      onPress: item.executionId ? () => router.push(`/executions/${item.executionId}` as never) : () => undefined,
    })),
  ];
  const resultMessages = [
    ...(today.data?.processed ?? []).map((item) => ({
      id: `result:${item.id}`,
      icon: '✓',
      title: item.planName,
      description: item.resultSummary ?? executionStatusLabel(item.status),
      meta: formatMessageTime(item.finishedAt),
      onPress: () => router.push(`/executions/${item.id}` as never),
    })),
    ...summaryAlerts.map((item) => ({
      id: `summary:${item.id}`,
      icon: '▤',
      title: item.title,
      description: consumerErrorMessage(item.body),
      meta: formatMessageTime(item.createdAt),
      onPress: item.executionId ? () => router.push(`/executions/${item.executionId}` as never) : undefined,
    })),
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={today.isFetching} onRefresh={() => today.refetch()} /> : undefined}
      >
        <WorkspaceHeader title="消息" subtitle={`今天 · ${formatToday()}`} />

        {state === 'signed_out' ? (
          <CompactState icon="🛡" title="登录后开始使用" description="计划、提醒和完成结果会集中在这里。" actionLabel="开始使用" onPress={() => router.push('/connections')} />
        ) : null}

        {state === 'loading' ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在同步今天的消息…</Text></View>
        ) : null}

        {state === 'error' ? (
          <CompactState icon="↻" title="网络暂时不可用" description="请稍后再试，不会影响已有计划。" actionLabel="重试" onPress={() => today.refetch()} />
        ) : null}

        {state === 'empty' ? (
          <View style={styles.quietState}><View style={styles.quietIcon}><Text style={styles.quietCheck}>✓</Text></View><View style={styles.quietCopy}><Text style={styles.quietTitle}>今天一切顺利</Text><Text style={styles.quietDescription}>没有需要你处理的事情</Text></View></View>
        ) : null}

        {state === 'ready' ? (
          <>
            <View style={[styles.summaryBar, attentionCount > 0 && styles.summaryWarning]}>
              <View style={[styles.summaryDot, attentionCount > 0 && styles.summaryDotWarning]} />
              <Text style={styles.summaryText}>{attentionCount > 0 ? `${attentionCount} 件事情需要你看看` : '今天没有需要你处理的事情'}</Text>
            </View>

            {(today.data?.pendingApprovals.length ?? 0) > 0 ? (
              <WorkspaceSection title="待你确认" count={today.data?.pendingApprovals.length}>
                <View style={styles.approvalList}>
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
                </View>
              </WorkspaceSection>
            ) : null}

            {attentionMessages.length > 0 ? (
              <WorkspaceSection title="需要处理" count={attentionMessages.length}>
                <View style={styles.messageGroup}>{attentionMessages.map((item, index) => <MessageRow key={item.id} {...item} last={index === attentionMessages.length - 1} />)}</View>
              </WorkspaceSection>
            ) : null}

            {resultMessages.length > 0 ? (
              <WorkspaceSection title="最近完成" action={{ label: '全部记录', onPress: () => router.push('/records') }}>
                <View style={styles.messageGroup}>{resultMessages.slice(0, 6).map((item, index, shown) => <MessageRow key={item.id} {...item} tone="success" last={index === shown.length - 1} />)}</View>
              </WorkspaceSection>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CompactState({ icon, title, description, actionLabel, onPress }: { icon: string; title: string; description: string; actionLabel: string; onPress: () => void }) {
  return (
    <View style={styles.compactState}>
      <View style={styles.compactStateIcon}><Text style={styles.compactStateGlyph}>{icon}</Text></View>
      <View style={styles.compactStateCopy}>
        <Text style={styles.compactStateTitle}>{title}</Text>
        <Text style={styles.compactStateDescription} numberOfLines={2}>{description}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.compactStateAction}>
        <Text style={styles.compactStateActionText}>{actionLabel}</Text>
      </Pressable>
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

function notificationCandidateSummary(item: PendingNotificationCandidate) {
  if (item.candidateResource === 'mobile.billing.transaction' && item.amountMinor !== null && item.currency === 'CNY') return `检测到一条可能的消费线索，金额为 ${(item.amountMinor / 100).toFixed(2)} 元。确认前不会记录为账单。`;
  return item.candidateConfidence > 0 ? '检测到一条可能与账户相关的线索，确认前不会记录为事实。' : '收到一条待分类的应用通知线索，不会触发自动操作。';
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

function formatExpiry(value: string) {
  return `${new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效`;
}

function formatMessageTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  loading: { alignItems: 'center', paddingVertical: 64, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  compactState: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#F2F3F5', borderRadius: radius.md },
  compactStateIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  compactStateGlyph: { color: colors.primary, fontSize: 17, fontWeight: '900' },
  compactStateCopy: { flex: 1 },
  compactStateTitle: { ...typography.bodyStrong, color: colors.text },
  compactStateDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  compactStateAction: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  compactStateActionText: { ...typography.label, color: '#FFFFFF' },
  quietState: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  quietIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' },
  quietCheck: { color: '#23A559', fontWeight: '900', fontSize: 16 },
  quietCopy: { flex: 1 },
  quietTitle: { ...typography.bodyStrong, color: colors.text },
  quietDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  summaryBar: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: '#E8F7EF' },
  summaryWarning: { backgroundColor: '#FFF4E5' },
  summaryDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#23A559' },
  summaryDotWarning: { backgroundColor: '#F79009' },
  summaryText: { ...typography.bodyStrong, color: colors.text },
  approvalList: { gap: spacing.sm },
  messageGroup: { backgroundColor: '#FFFFFF', paddingHorizontal: 0 },
});
