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
  return <RuntimeDetailScreen title="执行生命周期" subtitle="15 步只读投影；只展示已有持久化证据" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取执行生命周期…" /> : null}
    {detail.data ? <>
      <RuntimeSection title="安全语义"><RuntimeCard><RuntimeText>页面不会启动、重试或修复执行。NOT_REACHED 表示没有到达证据；UNKNOWN 与 OUTCOME_UNKNOWN 不会被改写成成功。</RuntimeText></RuntimeCard></RuntimeSection>
      <RuntimeSection title="15 步 Lifecycle"><LifecycleTimeline steps={[...detail.data.lifecycle.steps]} /></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
