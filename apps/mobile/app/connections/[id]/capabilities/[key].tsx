import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../../../src/api';
import { useAuthStore } from '../../../../src/auth-store';
import { capabilityDimensionLabel, capabilityGapCopy } from '../../../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../../src/runtime-details-ui';

interface CapabilityDetail {
  connectionId: string; providerKey: string; providerName: string; manifestRevision: number | null; providerReview: string;
  capability: { key: string; name: string; operation: string; riskLevel: string; dataBoundary: string | null; verificationMethods: string[]; providerAvailability: string; implementation: string; grant: string; health: string; usable: boolean; reasons: string[] };
}
export default function ConnectionCapabilityDetail() {
  const { id, key } = useLocalSearchParams<{ id: string; key: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({ queryKey: ['connection-capability', id, key, token], queryFn: () => api<CapabilityDetail>(`/connections/${id}/capabilities/${key}`, token), enabled: Boolean(id && key && token) });
  const data = detail.data;
  return <RuntimeDetailScreen title="能力详情" subtitle="当前连接的真实可用性，不使用默认或模拟状态" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取能力状态…" /> : null}
    {data ? <>
      <RuntimeSection title={data.capability.name}><RuntimeCard><RuntimeKeyValue label="Provider" value={data.providerName} /><RuntimeKeyValue label="能力键" value={data.capability.key} /><RuntimeKeyValue label="操作" value={data.capability.operation} /><RuntimeKeyValue label="当前可用" value={data.capability.usable ? '是' : '否'} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="四个独立维度"><RuntimeCard><RuntimeKeyValue label="Provider Availability" value={capabilityDimensionLabel('providerAvailability', data.capability.providerAvailability)} /><RuntimeKeyValue label="Implementation" value={capabilityDimensionLabel('implementation', data.capability.implementation)} /><RuntimeKeyValue label="Grant" value={capabilityDimensionLabel('grant', data.capability.grant)} /><RuntimeKeyValue label="Health" value={capabilityDimensionLabel('health', data.capability.health)} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="Capability Gap"><RuntimeCard><RuntimeText>{capabilityGapCopy(data.capability.reasons)}</RuntimeText></RuntimeCard></RuntimeSection>
      <RuntimeSection title="版本与边界"><RuntimeCard><RuntimeKeyValue label="Manifest 版本" value={data.manifestRevision === null ? '未记录' : `v${data.manifestRevision}`} /><RuntimeKeyValue label="Provider Review" value={data.providerReview} /><RuntimeKeyValue label="数据边界" value={data.capability.dataBoundary} /><RuntimeKeyValue label="验证方式" value={data.capability.verificationMethods.join('、') || '未声明'} last /></RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
