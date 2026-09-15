import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { colors, radius, spacing, typography } from '../../src/design';
import { displayTime, reconciliationSafetyCopy, reconciliationStatusCopy, runtimeResultCopy, shortHash } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';
import type { ReconciliationCaseSummary } from '../../src/verification-presenter';

interface VerificationEvidence {
  id: string;
  method: string;
  resultState: string;
  evidenceKey: string;
  evidenceHash: string;
  verifiedAt: string;
}
interface ReconciliationDetail extends ReconciliationCaseSummary {
  executionId: string;
  executionStepId: string;
  operationId: string;
  expiresAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  evidence: VerificationEvidence[];
}

export default function ReconciliationDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['reconciliation-case', id, token], queryFn: () => api<ReconciliationDetail>(`/reconciliation-cases/${id}`, token), enabled: Boolean(id && token) });
  const recheck = useMutation({
    mutationFn: () => api<ReconciliationDetail>(`/reconciliation-cases/${id}/recheck`, token, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (data) => queryClient.setQueryData(['reconciliation-case', id, token], data),
  });
  const data = detail.data;
  return <RuntimeDetailScreen title="Reconciliation" subtitle="确认真实结果，而不是重复原动作" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取回查详情…" /> : null}
    {data ? <>
      <RuntimeSection title="当前状态"><RuntimeCard><RuntimeKeyValue label="状态" value={reconciliationStatusCopy(data.status)} /><RuntimeKeyValue label="结果" value={runtimeResultCopy(data.resultState)} /><RuntimeKeyValue label="回查次数" value={data.attemptCount} /><RuntimeKeyValue label="到期时间" value={displayTime(data.expiresAt)} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="不重发语义"><RuntimeCard><RuntimeText>{reconciliationSafetyCopy()}</RuntimeText>{data.status === 'OPEN' ? <Pressable accessibilityRole="button" disabled={recheck.isPending} onPress={() => recheck.mutate()} style={styles.action}><Text style={styles.actionText}>{recheck.isPending ? '正在请求只读回查…' : '请求只读回查'}</Text></Pressable> : null}{recheck.isError ? <Text style={styles.error}>当前不能继续回查；系统没有重发原动作。</Text> : null}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="Verification Evidence"><RuntimeCard>{data.evidence.length === 0 ? <RuntimeText>尚无回查证据，结果保持 {runtimeResultCopy(data.resultState)}。</RuntimeText> : data.evidence.map((item) => <RuntimeCard key={item.id} title={item.method}><RuntimeKeyValue label="结果" value={runtimeResultCopy(item.resultState)} /><RuntimeKeyValue label="证据键" value={item.evidenceKey} /><RuntimeKeyValue label="证据哈希" value={shortHash(item.evidenceHash)} /><RuntimeKeyValue label="验证时间" value={displayTime(item.verifiedAt)} last /></RuntimeCard>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="关联记录"><RuntimeCard><RuntimeKeyValue label="Execution" value={data.executionId} /><RuntimeKeyValue label="Operation" value={data.operationId} /><RuntimeKeyValue label="最后更新" value={displayTime(data.updatedAt)} last /><Pressable accessibilityRole="button" onPress={() => router.push(`/executions/${data.executionId}` as never)} style={styles.link}><Text style={styles.linkText}>查看执行记录</Text></Pressable></RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  action: { alignSelf: 'flex-start', marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  actionText: { ...typography.bodyStrong, color: colors.primary }, error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  link: { alignSelf: 'flex-start', marginTop: spacing.md }, linkText: { ...typography.bodyStrong, color: colors.primary },
});
