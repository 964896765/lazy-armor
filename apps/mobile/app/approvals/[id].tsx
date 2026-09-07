import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { colors, spacing, typography, WorkspaceHeader } from '../../src/design';
import { approvalRiskText, approvalStatusLabel } from '../../src/today-presenter';

interface ApprovalDetail {
  id: string; executionId: string; status: string; effectiveRiskLevel: string; actionSummary: string; reason: string | null; expiresAt: string; createdAt: string; decidedAt: string | null; decisionReason: string | null;
  decisions: Array<{ id: string; decision: string; reason: string | null; createdAt: string }>;
}

export default function ApprovalDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['approval', id, token], queryFn: () => api<ApprovalDetail>(`/approvals/${id}`, token), enabled: Boolean(id && token) });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => api(`/approvals/${id}/${decision}`, token, { method: 'POST', body: JSON.stringify(decision === 'approve' && detail.data?.effectiveRiskLevel === 'R4' ? { confirmation: 'APPROVE_R4', deviceId: 'mobile' } : { deviceId: 'mobile' }) }),
    onSuccess: async () => { await Promise.all([detail.refetch(), client.invalidateQueries({ queryKey: ['approvals', token] }), client.invalidateQueries({ queryKey: ['today', token] })]); },
  });
  const item = detail.data;
  const pending = item?.status === 'pending';
  const confirm = (decision: 'approve' | 'reject') => Alert.alert(decision === 'approve' ? '确认继续执行？' : '确认拒绝？', item?.actionSummary ?? '', [{ text: '返回', style: 'cancel' }, { text: decision === 'approve' ? '确认继续' : '拒绝', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => decide.mutate(decision) }]);

  return <SafeAreaView style={styles.safeArea} edges={['top']}><ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.primary} refreshing={detail.isFetching && !detail.isLoading} onRefresh={detail.refetch} />}>
    <WorkspaceHeader title="审批详情" subtitle="确认前先看清影响范围" onBack={() => router.back()} />
    {detail.isError ? <View style={styles.state}><Text style={styles.title}>暂时无法读取审批详情</Text><Pressable onPress={() => detail.refetch()}><Text style={styles.textAction}>重新加载</Text></Pressable></View> : null}
    {item ? <>
      <View style={styles.hero}><View style={[styles.riskIcon, !pending && styles.riskIconDone]}><Ionicons name={pending ? 'shield-outline' : 'checkmark'} size={22} color={pending ? colors.danger : colors.success} /></View><View style={styles.heroCopy}><Text style={styles.title}>{item.actionSummary}</Text><Text style={styles.muted}>{item.effectiveRiskLevel} · {approvalStatusLabel(item.status)} · {formatDate(item.createdAt)}</Text></View></View>
      <Section title="为什么需要你确认"><Text style={styles.body}>{approvalRiskText(item.effectiveRiskLevel)}</Text>{item.reason ? <Text style={styles.body}>{item.reason}</Text> : null}</Section>
      <Section title="影响与边界"><InfoRow label="风险等级" value={item.effectiveRiskLevel} /><InfoRow label="执行编号" value={`${item.executionId.slice(0, 12)}…`} /><InfoRow label="有效时间" value={formatDate(item.expiresAt)} /><InfoRow label="执行原则" value="只执行本次确认内容" last /></Section>
      {!pending ? <Section title="处理结果"><InfoRow label="状态" value={approvalStatusLabel(item.status)} />{item.decidedAt ? <InfoRow label="处理时间" value={formatDate(item.decidedAt)} /> : null}{item.decisionReason ? <Text style={styles.body}>{item.decisionReason}</Text> : null}</Section> : null}
      <View style={styles.safety}><Text style={styles.safetyTitle}>安全提醒</Text><Text style={styles.body}>懒人装甲不会把一次确认扩展成长期授权；资金和账户级操作仍需加强确认。</Text></View>
      {pending ? <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => confirm('reject')} disabled={decide.isPending} style={[styles.button, styles.secondaryButton]}><Text style={styles.secondaryText}>拒绝</Text></Pressable><Pressable accessibilityRole="button" onPress={() => confirm('approve')} disabled={decide.isPending} style={[styles.button, styles.primaryButton]}><Text style={styles.primaryText}>{decide.isPending ? '处理中…' : '确认继续'}</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={() => router.push(`/executions/${item.executionId}` as never)} style={[styles.button, styles.primaryButton]}><Text style={styles.primaryText}>查看执行记录</Text></Pressable>}
    </> : null}
  </ScrollView></SafeAreaView>;
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.section}><View style={styles.sectionHeading}><View style={styles.accent} /><Text style={styles.sectionTitle}>{title}</Text></View>{children}</View>; }
function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) { return <View style={[styles.infoRow, !last && styles.divider]}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1, backgroundColor: colors.surface }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  state: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, textAction: { ...typography.bodyStrong, color: colors.primary },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border }, riskIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft }, riskIconDone: { backgroundColor: colors.successSoft }, heroCopy: { flex: 1, minWidth: 0 }, title: { ...typography.cardTitle, color: colors.text }, muted: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  section: { paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }, accent: { width: 3, height: 16, borderRadius: 2, backgroundColor: colors.primary }, sectionTitle: { ...typography.section, color: colors.text }, body: { ...typography.body, color: colors.textSecondary, lineHeight: 21, marginTop: 4 }, infoRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, infoLabel: { ...typography.caption, color: colors.textSecondary }, infoValue: { ...typography.bodyStrong, color: colors.text, textAlign: 'right', flexShrink: 1 },
  safety: { marginVertical: spacing.lg, padding: spacing.md, borderRadius: 12, backgroundColor: colors.dangerSoft }, safetyTitle: { ...typography.bodyStrong, color: colors.danger }, actions: { flexDirection: 'row', gap: spacing.sm }, button: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 12 }, primaryButton: { backgroundColor: colors.primary }, secondaryButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }, primaryText: { ...typography.bodyStrong, color: '#FFFFFF' }, secondaryText: { ...typography.bodyStrong, color: colors.text },
});
