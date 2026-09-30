import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { LifecycleReadProjection } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { LifecycleTimeline, LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

interface ExecutionLifecycleResponse {
  subject: { type: 'execution'; id: string };
  lifecycle: LifecycleReadProjection;
}

export default function ExecutionLifecyclePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({
    queryKey: ['execution-lifecycle', id, token],
    queryFn: () => api<ExecutionLifecycleResponse>(`/executions/${id}/lifecycle`, token),
    enabled: Boolean(id && token),
  });
  return <RuntimeDetailScreen title="执行完整过程" subtitle="只读展示这次执行从发起到结果的完整过程" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取执行过程…" /> : null}
    {detail.data ? <>
      <RuntimeSection title="安全语义"><RuntimeCard><RuntimeText>页面不会启动、重试或修复执行。尚未到达、状态未知与结果待确认的步骤不会被改写成成功。</RuntimeText></RuntimeCard></RuntimeSection>
      <RuntimeSection title="完整过程"><LifecycleTimeline steps={[...detail.data.lifecycle.steps]} /></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
