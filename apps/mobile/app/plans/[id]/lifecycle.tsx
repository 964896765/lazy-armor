import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { RuntimeDetailScreen, RuntimeLoadState, LifecycleTimeline, LoginRequired, RuntimeSection, RuntimeCard, RuntimeText } from '../../../src/runtime-details-ui';
import type { RuntimeLifecycleResponse } from '../../../src/runtime-details-presenter';

export default function PlanLifecyclePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({ queryKey: ['plan-lifecycle', id, token], queryFn: () => api<RuntimeLifecycleResponse>(`/plans/${id}/lifecycle`, token), enabled: Boolean(id && token) });
  return <RuntimeDetailScreen title="计划完整过程" subtitle="只读展示这条计划从来源到结果的完整过程；没有运行记录时，步骤会如实显示为尚未到达" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取计划过程…" /> : null}
    {detail.data ? <><RuntimeSection title="读取说明"><RuntimeCard><RuntimeText>这条页面不会启动、重试或修改计划。没有运行记录时，所有步骤都如实显示为“尚未到达”。</RuntimeText></RuntimeCard></RuntimeSection><RuntimeSection title="完整过程"><LifecycleTimeline steps={detail.data.lifecycle.steps} /></RuntimeSection></> : null}
  </RuntimeDetailScreen>;
}
