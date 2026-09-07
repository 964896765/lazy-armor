import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { colors, spacing, typography, WorkspaceHeader } from '../src/design';
import { approvalRiskText, approvalStatusLabel } from '../src/today-presenter';

interface ApprovalSummary {
  id: string;
  executionId: string;
  executionStepId: string;
  status: string;
  effectiveRiskLevel: string;
  actionSummary: string;
  expiresAt: string;
  createdAt: string;
  planName: string;
}

type Filter = 'pending' | 'processed' | 'all';

export default function ApprovalsPage() {
  const token = useAuthStore((state) => state.token);
  const [filter, setFilter] = useState<Filter>('pending');
  const approvals = useQuery({ queryKey: ['approvals', token], queryFn: () => api<ApprovalSummary[]>('/approvals', token), enabled: Boolean(token) });
  const data = approvals.data ?? [];
  const shown = filter === 'pending' ? data.filter((item) => item.status === 'pending') : filter === 'processed' ? data.filter((item) => item.status !== 'pending') : data;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.primary} refreshing={approvals.isFetching && !approvals.isLoading} onRefresh={approvals.refetch} />}>
        <WorkspaceHeader title="审批中心" subtitle="需要你确认的重要事项" onBack={() => router.back()} />
        <View style={styles.tabs}>
          <FilterTab label="待审批" count={data.filter((item) => item.status === 'pending').length} selected={filter === 'pending'} onPress={() => setFilter('pending')} />
          <FilterTab label="已处理" count={data.filter((item) => item.status !== 'pending').length} selected={filter === 'processed'} onPress={() => setFilter('processed')} />
          <FilterTab label="全部" count={data.length} selected={filter === 'all'} onPress={() => setFilter('all')} />
        </View>
        {approvals.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取审批事项…</Text></View> : null}
        {approvals.isError ? <InlineState title="审批事项暂时不可用" action="重新加载" onPress={() => approvals.refetch()} /> : null}
        {!approvals.isLoading && !approvals.isError && shown.length === 0 ? <InlineState title={filter === 'pending' ? '没有待审批事项' : '这里还没有记录'} detail="需要确认的操作会清楚说明风险和影响。" action="返回" onPress={() => router.back()} /> : null}
        {shown.map((item, index) => <ApprovalRow key={item.id} item={item} last={index === shown.length - 1} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.tab, selected && styles.tabSelected]}><Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>{count > 0 ? <View style={[styles.count, selected && styles.countSelected]}><Text style={[styles.countText, selected && styles.countTextSelected]}>{count}</Text></View> : null}</Pressable>;
}

function ApprovalRow({ item, last }: { item: ApprovalSummary; last: boolean }) {
  const pending = item.status === 'pending';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/approvals/${item.id}` as never)} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      <View style={[styles.riskIcon, pending ? styles.riskPending : styles.riskDone]}><Ionicons name={pending ? 'alert' : 'checkmark'} size={20} color={pending ? colors.danger : colors.success} /></View>
      <View style={styles.rowCopy}>
        <View style={styles.rowHeading}><Text numberOfLines={1} style={styles.rowTitle}>{item.planName}</Text><View style={[styles.statusPill, !pending && styles.statusPillDone]}><Text style={[styles.statusText, !pending && styles.statusTextDone]}>{approvalStatusLabel(item.status)}</Text></View></View>
        <Text numberOfLines={2} style={styles.rowSubtitle}>{item.actionSummary}</Text>
        <Text style={styles.rowMeta}>{pending ? expiryLabel(item.expiresAt) : approvalRiskText(item.effectiveRiskLevel)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function InlineState({ title, detail, action, onPress }: { title: string; detail?: string; action: string; onPress: () => void }) { return <View style={styles.inlineState}><View style={styles.inlineCopy}><Text style={styles.rowTitle}>{title}</Text>{detail ? <Text style={styles.rowSubtitle}>{detail}</Text> : null}</View><Pressable accessibilityRole="button" onPress={onPress}><Text style={styles.textAction}>{action}</Text></Pressable></View>; }
function expiryLabel(value: string) { const date = new Date(value); return date.getTime() <= Date.now() ? '确认窗口已结束' : `${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 前有效`; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1, backgroundColor: colors.surface }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, tab: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 10, backgroundColor: colors.background }, tabSelected: { backgroundColor: colors.successSoft }, tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' }, tabTextSelected: { color: colors.primary }, count: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border }, countSelected: { backgroundColor: colors.primary }, countText: { fontSize: 8, fontWeight: '800', color: colors.textSecondary }, countTextSelected: { color: '#FFFFFF' },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 64 }, muted: { ...typography.caption, color: colors.textSecondary },
  row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, pressed: { backgroundColor: colors.pressed }, riskIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, riskPending: { backgroundColor: colors.dangerSoft }, riskDone: { backgroundColor: colors.successSoft }, rowCopy: { flex: 1, minWidth: 0 }, rowHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 }, rowMeta: { fontSize: 9, lineHeight: 13, color: colors.warning, marginTop: 4 }, statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.warningSoft }, statusPillDone: { backgroundColor: colors.successSoft }, statusText: { fontSize: 8, lineHeight: 11, color: colors.warning, fontWeight: '800' }, statusTextDone: { color: colors.success },
  inlineState: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, inlineCopy: { flex: 1 }, textAction: { ...typography.bodyStrong, color: colors.primary },
});
