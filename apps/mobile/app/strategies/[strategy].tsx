import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface Strategy { schemaVersion: string; key: string; label: string; revision: number; status: string; triggerModes: string[]; defaultActionMode: string; attentionPolicy: string; approvalPolicy: string; verificationPolicy: string; allowedAutomationCeiling: string }
export default function StrategyDetailPage() {
  const { strategy } = useLocalSearchParams<{ strategy: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({ queryKey: ['strategy', strategy, token], queryFn: () => api<Strategy>(`/strategies/${strategy}`, token), enabled: Boolean(strategy && token) });
  return <RuntimeDetailScreen title="策略详情" subtitle="固定版本定义，不替代实时执行状态" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取策略定义…" /> : null}
    {detail.data ? <><RuntimeSection title={detail.data.label}><RuntimeCard><RuntimeKeyValue label="策略键" value={detail.data.key} /><RuntimeKeyValue label="定义版本" value={`v${detail.data.revision}`} /><RuntimeKeyValue label="状态" value={detail.data.status} last /></RuntimeCard></RuntimeSection><RuntimeSection title="运行规则"><RuntimeCard><RuntimeKeyValue label="默认动作模式" value={detail.data.defaultActionMode} /><RuntimeKeyValue label="可用触发方式" value={detail.data.triggerModes.join('、')} /><RuntimeKeyValue label="关注策略" value={detail.data.attentionPolicy} /><RuntimeKeyValue label="确认策略" value={detail.data.approvalPolicy} /><RuntimeKeyValue label="验证策略" value={detail.data.verificationPolicy} /><RuntimeKeyValue label="最高自动化风险" value={detail.data.allowedAutomationCeiling} last /></RuntimeCard></RuntimeSection><RuntimeSection title="解释"><RuntimeCard><RuntimeText>这是一条版本化产品定义。是否能在你的账号上运行，仍取决于具体场景的 Readiness、连接授权与健康状态。</RuntimeText></RuntimeCard></RuntimeSection></> : null}
  </RuntimeDetailScreen>;
}
