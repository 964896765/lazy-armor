import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../../src/auth-store';
import { getDeviceTaskEvidence } from '../../../src/device-task-client';
import { ActionButton } from '../../../src/design';
import { displayTime } from '../../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

export default function DeviceTaskDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const detail = useQuery({
    queryKey: ['device-task-evidence', id, token],
    queryFn: () => getDeviceTaskEvidence(token!, id!),
    enabled: Boolean(token && id),
    staleTime: 0,
  });
  const evidence = detail.data;
  return <RuntimeDetailScreen title="手机任务详情" subtitle="只展示服务器已记录的状态与证据" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在核对设备任务…" /> : null}
    {evidence ? <>
      <RuntimeSection title="任务状态"><RuntimeCard>
        <RuntimeKeyValue label="任务" value={evidence.task.taskType} />
        <RuntimeKeyValue label="资源" value={evidence.task.resourceType} />
        <RuntimeKeyValue label="状态" value={evidence.task.status} />
        <RuntimeKeyValue label="创建时间" value={displayTime(evidence.task.createdAt)} />
        <RuntimeKeyValue label="完成时间" value={evidence.task.completedAt ? displayTime(evidence.task.completedAt) : '尚未完成'} />
        {evidence.task.errorCode ? <RuntimeKeyValue label="失败原因" value={evidence.task.errorCode} last /> : null}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="现实数据证据"><RuntimeCard>
        {evidence.observations.length === 0 ? <RuntimeText>尚无已记录的来源观察；不会把待执行任务显示为已验证。</RuntimeText> : evidence.observations.map((item) =>
          <RuntimeCard key={item.id} title="来源观察"><RuntimeKeyValue label="状态" value={item.status} /><RuntimeKeyValue label="观察时间" value={displayTime(item.observedAt)} last /></RuntimeCard>)}
        {evidence.readEvidence.map((item) => <RuntimeCard key={item.id} title="读取验证"><RuntimeKeyValue label="状态" value={item.status} />{item.blockedReason ? <RuntimeKeyValue label="阻断原因" value={item.blockedReason} last /> : null}</RuntimeCard>)}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="事实确认"><RuntimeCard>
        {evidence.candidates.length > 0 ? <RuntimeKeyValue label="候选事实" value={`${evidence.candidates.length} 条`} /> : null}
        {evidence.truths.length === 0 ? <RuntimeText>尚未形成可信事实；任务状态不能替代 Truth 验证。</RuntimeText> : evidence.truths.map((item) =>
          <RuntimeCard key={item.id} title={item.current ? '当前可信事实' : '历史或已撤销事实'}>
            <RuntimeKeyValue label="状态" value={item.status} />
            <ActionButton label="查看事实依据" tone="quiet" onPress={() => router.push(`/truth/${item.id}`)} />
          </RuntimeCard>)}
      </RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
