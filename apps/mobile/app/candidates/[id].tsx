import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton } from '../../src/design';
import { RuntimeDetailScreen, RuntimeCard, RuntimeKeyValue, RuntimeText, RuntimeLoadState, LoginRequired } from '../../src/runtime-details-ui';

interface CandidateDetail {
  id: string; status: string; resourceType: string; truthRecordId: string | null;
  value: Record<string, unknown>;
  source: { providerKey: string; observedAt: string };
}

export default function CandidateReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore(state => state.token);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['candidate', id, token], enabled: Boolean(id && token), queryFn: () => api<CandidateDetail>('/candidates/' + id, token) });
  const decide = useMutation({ mutationFn: (confirmed: boolean) => api('/candidates/' + id + (confirmed ? '/confirm' : '/reject'), token, { method: 'POST', body: '{}' }),
    onSuccess: async () => { await query.refetch(); await client.invalidateQueries({ queryKey: ['device-task-evidence'] }); } });
  const candidate = query.data;
  const field = typeof candidate?.value.field === 'string' ? candidate.value.field : '';
  const label = ({ 'wallet.balance': '余额', 'transaction.latest.amount': '最近交易金额', 'transaction.latest.time': '最近交易时间', 'com.miui.calculator:id/result': '计算器当前结果' } as Record<string, string>)[field] ?? '读取线索';
  const value = candidate?.value.value;
  return <RuntimeDetailScreen title="核实读取线索" subtitle="先核对本次观察，再决定是否记为事实" onBack={() => router.canGoBack() ? router.back() : router.replace('/resources' as never)}>
    {!token ? <LoginRequired /> : <RuntimeLoadState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()} />}
    {candidate ? <RuntimeCard title={label}>
      <RuntimeKeyValue label="读到的内容" value={typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '请先查看来源依据'} />
      <RuntimeKeyValue label="观察时间" value={new Date(candidate.source.observedAt).toLocaleString('zh-CN')} />
      <RuntimeKeyValue label="来源" value={candidate.source.providerKey === 'edge-device' ? '本次手机页面读取' : candidate.source.providerKey} />
      <RuntimeText>这里记录的是该时间点读到的线索。只有你核对并确认后，才记入可信事实。</RuntimeText>
      {candidate.status === 'PENDING' ? <><ActionButton label={decide.isPending ? '正在保存…' : '确认这条线索'} disabled={decide.isPending} onPress={() => decide.mutate(true)} /><ActionButton label="内容不正确" tone="quiet" disabled={decide.isPending} onPress={() => decide.mutate(false)} /></> : <RuntimeText>{candidate.status === 'VERIFIED' ? '你已核实这条线索。' : '这条线索已被拒绝。'}</RuntimeText>}
      {candidate.truthRecordId ? <ActionButton label="查看事实依据" tone="quiet" onPress={() => router.push(`/truth/${candidate.truthRecordId}` as never)} /> : null}
      {decide.isError ? <RuntimeText>本次未保存，请重试。原来源和历史状态会保留。</RuntimeText> : null}
    </RuntimeCard> : null}
  </RuntimeDetailScreen>;
}
