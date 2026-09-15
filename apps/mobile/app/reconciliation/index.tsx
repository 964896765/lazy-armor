import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { colors, radius, spacing, typography } from '../../src/design';
import { displayTime, reconciliationStatusCopy, runtimeResultCopy } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeDetailScreen, RuntimeLoadState } from '../../src/runtime-details-ui';
import type { ReconciliationCaseSummary } from '../../src/verification-presenter';

interface ReconciliationCase extends ReconciliationCaseSummary {
  executionId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export default function ReconciliationIndexPage() {
  const token = useAuthStore((store) => store.token);
  const cases = useQuery({ queryKey: ['reconciliation-cases', token], queryFn: () => api<ReconciliationCase[]>('/reconciliation-cases', token), enabled: Boolean(token) });
  return <RuntimeDetailScreen title="Reconciliation" subtitle="对不确定外部结果进行只读回查，不重发原动作">
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={cases.isLoading} error={cases.isError} empty={!cases.isLoading && !cases.isError && (cases.data?.length ?? 0) === 0} onRetry={() => cases.refetch()} loadingText="正在读取回查记录…" emptyTitle="没有待收口结果" emptyDescription="只有真实运行产生不确定结果后，才会出现 Reconciliation 记录。" /> : null}
    <View style={styles.list}>{cases.data?.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => router.push(`/reconciliation/${item.id}` as never)} style={styles.row}><View style={styles.copy}><Text style={styles.title}>{reconciliationStatusCopy(item.status)}</Text><Text style={styles.detail}>{runtimeResultCopy(item.resultState)} · 回查 {item.attemptCount} 次</Text><Text style={styles.detail}>{displayTime(item.updatedAt ?? item.createdAt)}</Text></View><Text style={styles.open}>查看</Text></Pressable>)}</View>
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md, overflow: 'hidden' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  copy: { flex: 1, minWidth: 0 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  open: { ...typography.label, color: colors.primary },
});
