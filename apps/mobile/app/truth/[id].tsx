import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { displayTime, provenanceMethodLabel, shortHash } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface TruthDetail {
  id: string; resourceKey: string; subjectKey: string; status: string; sourceReceiptId: string; verifiedBy: string; verifiedAt: string; currentVersionId: string | null;
  versions: Array<{ id: string; versionNumber: number; valueHash: string; verificationMethod: string; evidenceHash: string; createdAt: string }>;
  provenance: Array<{ truthRecordVersionId: string; providerKey: string; sourceMode: string; evidenceHash: string; observedAt: string; createdAt: string }>;
}
export default function TruthDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({ queryKey: ['truth-record', id, token], queryFn: () => api<TruthDetail>(`/truth-records/${id}`, token), enabled: Boolean(id && token) });
  return <RuntimeDetailScreen title="事实溯源" subtitle="仅显示持久化的确认与来源证据" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取事实溯源…" /> : null}
    {detail.data ? <>
      <RuntimeSection title="已验证事实"><RuntimeCard><RuntimeKeyValue label="资源类型" value={detail.data.resourceKey} /><RuntimeKeyValue label="主体" value={detail.data.subjectKey} /><RuntimeKeyValue label="确认方式" value={provenanceMethodLabel(detail.data.verifiedBy)} /><RuntimeKeyValue label="确认时间" value={displayTime(detail.data.verifiedAt)} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="Truth Version"><RuntimeCard>{detail.data.versions.length === 0 ? <RuntimeText>没有可显示的版本证据。</RuntimeText> : detail.data.versions.map((version, index) => <RuntimeCard key={version.id} title={`版本 ${version.versionNumber}`}><RuntimeKeyValue label="验证方式" value={provenanceMethodLabel(version.verificationMethod)} /><RuntimeKeyValue label="值哈希" value={shortHash(version.valueHash)} /><RuntimeKeyValue label="证据哈希" value={shortHash(version.evidenceHash)} /><RuntimeKeyValue label="记录时间" value={displayTime(version.createdAt)} last /></RuntimeCard>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="Truth Provenance"><RuntimeCard>{detail.data.provenance.length === 0 ? <RuntimeText>该版本未提供可安全展示的来源链；不会把缺失信息补成来源。</RuntimeText> : detail.data.provenance.map((item) => <RuntimeCard key={`${item.truthRecordVersionId}-${item.evidenceHash}`} title={item.providerKey}><RuntimeKeyValue label="来源模式" value={item.sourceMode} /><RuntimeKeyValue label="观察时间" value={displayTime(item.observedAt)} /><RuntimeKeyValue label="证据哈希" value={shortHash(item.evidenceHash)} last /></RuntimeCard>)}</RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
