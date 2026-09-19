import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { colors, spacing, typography } from '../../../src/design';
import { capabilityGapCopy, readinessLabel, readinessReasonCopy, stateActionCopy } from '../../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

interface ScenarioDefinition {
  key: string; domain: string; label: string; revision: number; status: string;
  primaryResourceTypes: string[]; requiredFacts: string[]; optionalFacts: string[];
  supportedStrategies: string[]; defaultStrategy: string;
  sourceRequirements: Array<{ operation: string; resourceType: string; capabilityKey: string; optional: boolean }>;
  actionRequirements: Array<{ operation: string; resourceType: string; capabilityKey: string; optional: boolean }>;
  minimumReality: string; defaultRiskFloor: string;
  verificationRequirements: string[]; fallbackPolicy: { unknown: string; conflict: string; unavailable: string };
}
interface Readiness { scenarioKey: string; state: string; missingFacts: string[]; missingCapabilities: string[]; reasons: string[]; evaluatedAgainstRevision: number }
interface CapabilityReadinessEvidence {
  capabilityKey: string; providerKey: string; connectionId: string;
  operation: string; riskLevel: string;
  dimensions: Record<string, boolean>;
  providerAvailability: string; implementation: string; grant: string; health: string;
  usable: boolean; reasons: string[];
}
interface ScenarioRuntimeEvidence {
  scenarioKey: string; scenarioRevision: number; evaluatedAt: string;
  availableFacts: string[]; missingFacts: string[];
  observationPipelineAvailable: boolean; executionPipelineAvailable: boolean;
  providerBlocked: boolean; manualInputAvailable: boolean;
  capabilities: CapabilityReadinessEvidence[];
  readiness: Readiness;
}

function scenarioBlockers(evidence: ScenarioRuntimeEvidence): string[] {
  const list: string[] = [];
  for (const reason of evidence.readiness.reasons) list.push(readinessReasonCopy(reason));
  for (const capability of evidence.capabilities) {
    for (const reason of capability.reasons) list.push(capabilityGapCopy([reason]));
  }
  return [...new Set(list)];
}

export default function DomainScenarioPage() {
  const { domain, scenario } = useLocalSearchParams<{ domain: string; scenario: string }>();
  const token = useAuthStore((store) => store.token);
  const scenarioKey = domain && scenario ? `${domain}.${scenario}` : '';
  const definition = useQuery({ queryKey: ['scenario-definition', scenarioKey], queryFn: () => api<ScenarioDefinition>(`/scenarios/${scenarioKey}`), enabled: Boolean(scenarioKey) });
  const readiness = useQuery({ queryKey: ['scenario-readiness', scenarioKey, token], queryFn: () => api<Readiness>(`/scenarios/${scenarioKey}/readiness`, token), enabled: Boolean(scenarioKey && token) });
  const runtime = useQuery({ queryKey: ['scenario-runtime-evidence', scenarioKey, token], queryFn: () => api<{ runtime: ScenarioRuntimeEvidence }>(`/scenario-coverage-ledger/${scenarioKey}/runtime-evidence`, token), enabled: Boolean(scenarioKey && token) });
  const data = definition.data;
  const blockers = runtime.data ? scenarioBlockers(runtime.data.runtime) : readiness.data ? readiness.data.reasons.map(readinessReasonCopy) : [];
  const nextStep = stateActionCopy((runtime.data?.runtime.readiness ?? readiness.data)?.state ?? '');
  return <RuntimeDetailScreen title="场景运行条件" subtitle="来自版本化产品定义与当前账号状态" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={definition.isLoading || readiness.isLoading || runtime.isLoading} error={definition.isError || readiness.isError || runtime.isError} onRetry={() => { void definition.refetch(); void readiness.refetch(); void runtime.refetch(); }} loadingText="正在读取场景定义和可用性…" /> : null}
    {token && data && readiness.data ? <>
      <RuntimeSection title={data.label}><RuntimeCard><RuntimeKeyValue label="场景键" value={data.key} /><RuntimeKeyValue label="定义版本" value={`v${data.revision}`} /><RuntimeKeyValue label="当前 Readiness" value={readinessLabel(readiness.data.state)} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="现实与执行边界"><RuntimeCard><RuntimeKeyValue label="最低现实等级" value={data.minimumReality} /><RuntimeKeyValue label="默认风险下限" value={data.defaultRiskFloor} /><RuntimeKeyValue label="未知结果处理" value={data.fallbackPolicy.unknown} /><RuntimeKeyValue label="冲突处理" value={data.fallbackPolicy.conflict} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="需要的事实与能力"><RuntimeCard><RuntimeText emphasis>事实</RuntimeText><RuntimeText>{data.requiredFacts.join('、') || '未声明'}</RuntimeText><View style={styles.gap} /><RuntimeText emphasis>能力</RuntimeText><RuntimeText>{[...data.sourceRequirements, ...data.actionRequirements].map((item) => item.capabilityKey).join('、') || '未声明'}</RuntimeText></RuntimeCard></RuntimeSection>
      <RuntimeSection title="为什么现在还不能直接用"><RuntimeCard>{blockers.length === 0 ? <RuntimeText>已具备所需条件，可以开始使用。</RuntimeText> : blockers.map((blocker) => <RuntimeText key={blocker}>{blocker}</RuntimeText>)}<View style={styles.gap} /><RuntimeText emphasis>你可以这样做</RuntimeText><RuntimeText>{nextStep}</RuntimeText></RuntimeCard></RuntimeSection>
      <RuntimeSection title="可选策略"><RuntimeCard>{data.supportedStrategies.map((strategy) => <Pressable accessibilityRole="button" key={strategy} onPress={() => router.push(`/strategies/${strategy}` as never)} style={styles.strategy}><Text style={styles.strategyText}>{strategy}{strategy === data.defaultStrategy ? ' · 默认' : ''}</Text></Pressable>)}</RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
const styles = StyleSheet.create({ gap: { height: spacing.sm }, strategy: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, strategyText: { ...typography.bodyStrong, color: colors.primary } });
