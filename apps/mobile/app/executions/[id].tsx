import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { consumerErrorMessage, consumerErrorNextStep } from '../../src/connection-presenter';
import { colors, spacing, typography, WorkspaceHeader } from '../../src/design';
import {
  executionAttentionLabel,
  executionNeedsAttention,
  executionStatusLabel,
  executionStepSummary,
  sortExecutionSteps,
} from '../../src/execution-presenter';
import { actionSummary } from '../../src/plan-presenter';
import { approvalStatusLabel } from '../../src/today-presenter';

interface Step {
  id: string;
  stepOrder: number;
  actionType: string;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  effectiveRiskLevel: string | null;
  approvalGateStatus: string | null;
}

interface ApprovalInfo {
  id: string;
  executionStepId: string;
  status: string;
  effectiveRiskLevel: string;
  actionSummary: string;
  reason: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  decision: string | null;
  decisionReason: string | null;
}

interface NotificationInfo {
  id: string;
  priority: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
}

interface Detail {
  planName: string;
  planVersionNumber: number;
  triggerType: string;
  status: string;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
  declaredRiskLevel: string;
  approvalStatus: string;
  steps: Step[];
  approvals: ApprovalInfo[];
  notifications: NotificationInfo[];
}

const POLLING_STATES = ['created', 'queued', 'running', 'retry_wait', 'waiting_approval'];

export default function ExecutionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const detail = useQuery({
    queryKey: ['execution', id, token],
    queryFn: () => api<Detail>(`/executions/${id}`, token),
    enabled: Boolean(id && token),
    refetchInterval: (query) => (POLLING_STATES.includes(query.state.data?.status ?? '') ? 2_000 : false),
  });

  const data = detail.data;
  const needsAttention = data ? executionNeedsAttention(data.status) : false;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor={colors.primary} refreshing={detail.isFetching && !detail.isLoading} onRefresh={detail.refetch} />}
      >
        <WorkspaceHeader title="执行记录" subtitle="查看这次任务的结果与过程" onBack={() => router.back()} />

        {detail.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取执行记录…</Text></View>
        ) : null}

        {detail.isError ? (
          <View style={styles.errorState}>
            <Text style={styles.sectionTitle}>记录暂时加载失败</Text>
            <Text style={styles.body}>没有修改任何数据，请稍后再试。</Text>
            <Pressable accessibilityRole="button" onPress={() => detail.refetch()} style={styles.inlineButton}><Text style={styles.inlineButtonText}>重新加载</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>{data.planName}</Text>
                <Text style={styles.muted}>{formatDate(data.createdAt)} · 版本 {data.planVersionNumber}</Text>
              </View>
              <View style={[styles.statusPill, statusTone(data.status)]}><Text style={[styles.statusText, statusTextTone(data.status)]}>{executionStatusLabel(data.status)}</Text></View>
            </View>

            <Section title="本次结果" accent={needsAttention ? colors.danger : colors.primary}>
              <Text style={styles.result}>{data.resultSummary ?? consumerErrorMessage(data.errorMessage) ?? '正在处理'}</Text>
              <Text style={styles.body}>{executionAttentionLabel(data.status)}</Text>
            </Section>

            {needsAttention ? (
              <View style={styles.alertSection}>
                <Text style={styles.alertTitle}>需要处理</Text>
                <Text style={styles.body}>{consumerErrorNextStep(data.errorMessage)}</Text>
                <Text style={styles.alertMeta}>确认状态：{approvalStatusLabel(data.approvalStatus)}</Text>
              </View>
            ) : null}

            {data.approvals.length > 0 ? (
              <Section title="确认记录" accent={colors.warning}>
                {data.approvals.map((approval, index) => (
                  <View key={approval.id} style={[styles.detailRow, index > 0 && styles.divider]}>
                    <View style={styles.detailCopy}>
                      <Text style={styles.rowTitle}>{approval.actionSummary}</Text>
                      {approval.reason ? <Text style={styles.rowSubtitle}>{consumerErrorMessage(approval.reason)}</Text> : null}
                      {approval.decisionReason ? <Text style={styles.rowSubtitle}>{approval.decisionReason}</Text> : null}
                    </View>
                    <View style={styles.compactStatus}><Text style={styles.compactStatusText}>{approvalStatusLabel(approval.status)}</Text></View>
                  </View>
                ))}
              </Section>
            ) : null}

            {data.notifications.length > 0 ? (
              <Section title="相关提醒" accent="#2F80ED">
                {data.notifications.map((item, index) => (
                  <View key={item.id} style={[styles.detailRow, index > 0 && styles.divider]}>
                    <View style={styles.notificationDot} />
                    <View style={styles.detailCopy}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Text style={styles.rowSubtitle}>{consumerErrorMessage(item.body)}</Text>
                    </View>
                    <Text style={styles.rowTime}>{shortTime(item.createdAt)}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section title="处理过程" accent={colors.primary}>
              <View style={styles.timeline}>
                {sortExecutionSteps(data.steps).map((step, index, ordered) => (
                  <View style={styles.stepRow} key={step.id}>
                    <View style={styles.stepTrack}>
                      <View style={[styles.stepDot, stepDotTone(step.status)]} />
                      {index < ordered.length - 1 ? <View style={styles.stepLine} /> : null}
                    </View>
                    <View style={[styles.stepCopy, index < ordered.length - 1 && styles.stepDivider]}>
                      <View style={styles.stepTitleRow}>
                        <Text style={styles.rowTitle}>{actionSummary(step.actionType, null)}</Text>
                        <Text style={styles.stepStatus}>{executionStepSummary(step.status)}</Text>
                      </View>
                      {step.errorMessage ? <Text style={styles.stepError}>{consumerErrorMessage(step.errorMessage)}</Text> : null}
                      {step.retryCount > 0 ? <Text style={styles.rowSubtitle}>已重试 {step.retryCount} 次</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}><View style={[styles.sectionAccent, { backgroundColor: accent }]} /><Text style={styles.sectionTitle}>{title}</Text></View>
      {children}
    </View>
  );
}

function statusTone(status: string) {
  if (['failed', 'cancelled'].includes(status)) return styles.statusDanger;
  if (['waiting_approval', 'retry_wait'].includes(status)) return styles.statusWarning;
  if (['succeeded', 'completed'].includes(status)) return styles.statusSuccess;
  return styles.statusNeutral;
}

function statusTextTone(status: string) {
  if (['failed', 'cancelled'].includes(status)) return styles.statusTextDanger;
  if (['waiting_approval', 'retry_wait'].includes(status)) return styles.statusTextWarning;
  if (['succeeded', 'completed'].includes(status)) return styles.statusTextSuccess;
  return styles.statusTextNeutral;
}

function stepDotTone(status: string) {
  if (['failed', 'cancelled'].includes(status)) return styles.stepDotDanger;
  if (['succeeded', 'completed'].includes(status)) return styles.stepDotSuccess;
  if (['waiting_approval', 'retry_wait'].includes(status)) return styles.stepDotWarning;
  return styles.stepDotNeutral;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 72 },
  muted: { ...typography.caption, color: colors.textSecondary },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  errorState: { paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineButton: { alignSelf: 'flex-start', marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.successSoft, borderRadius: 10 },
  inlineButtonText: { ...typography.bodyStrong, color: colors.primary },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroTitle: { ...typography.title, color: colors.text },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  statusSuccess: { backgroundColor: colors.successSoft },
  statusDanger: { backgroundColor: colors.dangerSoft },
  statusWarning: { backgroundColor: colors.warningSoft },
  statusNeutral: { backgroundColor: colors.accentSoft },
  statusTextSuccess: { color: colors.success },
  statusTextDanger: { color: colors.danger },
  statusTextWarning: { color: colors.warning },
  statusTextNeutral: { color: colors.primary },
  section: { paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionAccent: { width: 3, height: 16, borderRadius: 2 },
  sectionTitle: { ...typography.section, color: colors.text },
  result: { ...typography.cardTitle, color: colors.text, marginBottom: spacing.xs },
  alertSection: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.dangerSoft, borderRadius: 12 },
  alertTitle: { ...typography.section, color: colors.danger, marginBottom: spacing.xs },
  alertMeta: { ...typography.caption, color: colors.danger, fontWeight: '700', marginTop: spacing.sm },
  detailRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  detailCopy: { flex: 1, minWidth: 0 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  rowTime: { ...typography.caption, color: colors.textMuted },
  compactStatus: { backgroundColor: colors.warningSoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  compactStatusText: { fontSize: 9, lineHeight: 12, fontWeight: '800', color: colors.warning },
  notificationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2F80ED' },
  timeline: { paddingTop: spacing.xs },
  stepRow: { flexDirection: 'row', alignItems: 'stretch' },
  stepTrack: { width: 24, alignItems: 'center' },
  stepDot: { width: 10, height: 10, borderRadius: 5, marginTop: 18, zIndex: 1 },
  stepDotSuccess: { backgroundColor: colors.success },
  stepDotDanger: { backgroundColor: colors.danger },
  stepDotWarning: { backgroundColor: colors.warning },
  stepDotNeutral: { backgroundColor: '#2F80ED' },
  stepLine: { position: 'absolute', top: 27, bottom: -18, width: 2, backgroundColor: colors.border },
  stepCopy: { flex: 1, minWidth: 0, paddingVertical: spacing.md, marginLeft: spacing.sm },
  stepDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  stepTitleRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  stepStatus: { ...typography.caption, color: colors.success, fontWeight: '700' },
  stepError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs, lineHeight: 17 },
});
