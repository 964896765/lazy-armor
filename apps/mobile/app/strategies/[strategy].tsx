import { useQuery } from '@tanstack/react-query';
import { PLAN_STRATEGIES } from '@lazy-armor/plan-schema/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface Strategy { schemaVersion: string; key: string; label: string; revision: number; status: string; triggerModes: string[]; defaultActionMode: string; attentionPolicy: string; approvalPolicy: string; verificationPolicy: string; allowedAutomationCeiling: string }
export default function StrategyDetailPage() {
  const { strategy } = useLocalSearchParams<{ strategy: string }>();
  const token = useAuthStore((store) => store.token);
  const detail = useQuery({ queryKey: ['strategy', strategy, token], queryFn: () => api<Strategy>(`/strategies/${strategy}`, token), enabled: Boolean(strategy && token) });
  const consumer = PLAN_STRATEGIES.find((item) => item.key === detail.data?.key);
  return <RuntimeDetailScreen title={detail.data?.label ?? '策略详情'} subtitle="管理方式说明，不代表当前账号已经可自动运行" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取策略定义…" /> : null}
    {detail.data ? <><RuntimeSection title="它会怎样帮你"><RuntimeCard><RuntimeText emphasis>{consumer?.consumerLabel ?? detail.data.label}</RuntimeText><RuntimeText>策略只规定计划如何关注变化，不会自行获得数据、授权或执行权限。</RuntimeText></RuntimeCard></RuntimeSection><RuntimeSection title="使用前要知道"><RuntimeCard><RuntimeText>具体计划是否可用，取决于场景所需事实、来源授权、设备与服务健康状态。重要动作仍由后端按风险等级要求确认和验证。</RuntimeText></RuntimeCard></RuntimeSection><RuntimeSection title="策略定义"><RuntimeCard><RuntimeKeyValue label="定义版本" value={`v${detail.data.revision}`} /><RuntimeKeyValue label="定义状态" value={detail.data.status} /><RuntimeKeyValue label="触发方式" value={detail.data.triggerModes.join('、')} /><RuntimeKeyValue label="默认动作模式" value={detail.data.defaultActionMode} /><RuntimeKeyValue label="关注规则" value={detail.data.attentionPolicy} /><RuntimeKeyValue label="审批规则" value={detail.data.approvalPolicy} /><RuntimeKeyValue label="验证规则" value={detail.data.verificationPolicy} /><RuntimeKeyValue label="最高自动化风险" value={detail.data.allowedAutomationCeiling} last /></RuntimeCard></RuntimeSection></> : null}
  </RuntimeDetailScreen>;
}
