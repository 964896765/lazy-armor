import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton } from '../../src/design';
import { evidenceFreshness, evidenceStatusLabel, shortEvidenceHash, sourceModeLabel } from '../../src/evidence-presenter';
import { displayTime } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface EvidenceDetail {
  id: string;
  sourceType: string;
  packageIdentity: string;
  observedAt: string;
  evidenceHash: string;
  candidateKind: string | null;
  parserId: string;
  resourceHint: string;
  status: string;
  truth: { id: string; version: number } | null;
}

export default function EvidenceDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const detail = useQuery({ queryKey: ['mobile-evidence', id, token], queryFn: () => api<EvidenceDetail>(`/mobile-evidence/${id}`, token), enabled: Boolean(token && id) });
  const evidence = detail.data;
  const freshness = evidence ? evidenceFreshness({ observedAt: evidence.observedAt }) : null;

  return <RuntimeDetailScreen title="证据详情" subtitle="只展示可追溯的脱敏证据，不展示原始内容或凭据" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取脱敏证据…" /> : null}
    {evidence ? <>
      <RuntimeSection title="这条证据说明什么"><RuntimeCard>
        <RuntimeKeyValue label="处理状态" value={evidenceStatusLabel(evidence.status)} />
        <RuntimeKeyValue label="事实类型" value={evidence.candidateKind || evidence.resourceHint} />
        <RuntimeKeyValue label="可信事实" value={evidence.truth ? `已生成第 ${evidence.truth.version} 版` : '尚未形成'} last />
        {evidence.truth ? <ActionButton label="查看可信事实" tone="quiet" onPress={() => router.push(`/truth/${evidence.truth!.id}`)} /> : null}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="来源与时间"><RuntimeCard>
        <RuntimeKeyValue label="采集方式" value={sourceModeLabel(evidence.sourceType)} />
        <RuntimeKeyValue label="来源应用/服务" value={evidence.packageIdentity} />
        <RuntimeKeyValue label="观察时间" value={displayTime(evidence.observedAt)} />
        <RuntimeKeyValue label="时效状态" value={freshness?.label} last />
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="验证依据"><RuntimeCard>
        <RuntimeKeyValue label="标准化规则" value={evidence.parserId} />
        <RuntimeKeyValue label="资源提示" value={evidence.resourceHint} />
        <RuntimeKeyValue label="证据摘要" value={shortEvidenceHash(evidence.evidenceHash)} last />
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="隐私说明"><RuntimeCard><RuntimeText>此页不返回通知正文、页面节点、访问令牌、私钥或凭据。证据摘要只用于核对同一份输入是否被篡改。</RuntimeText></RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
