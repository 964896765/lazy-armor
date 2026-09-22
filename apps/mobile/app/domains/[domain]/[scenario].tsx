import { PLAN_STRATEGIES } from '@lazy-armor/plan-schema/mobile';
import { isConsumerReadinessProjection, type ConsumerActionPath, type ConsumerReadinessProjection } from '@lazy-armor/plan-schema/consumer';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { colors, radius, spacing, typography } from '../../../src/design';
import { readinessReasonCopy } from '../../../src/runtime-details-presenter';
import { displayTime } from '../../../src/runtime-details-presenter';
import { executionStatusLabel } from '../../../src/execution-presenter';
import { planStatusLabel } from '../../../src/plan-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

interface ScenarioDefinition {
  key: string; domain: string; label: string; revision: number; status: string;
  requiredFacts: string[]; supportedStrategies: string[]; defaultStrategy: string;
  sourceRequirements: Array<{ capabilityKey: string }>;
  actionRequirements: Array<{ capabilityKey: string }>;
  defaultRiskFloor: string; fallbackPolicy: { unknown: string };
}
interface Readiness { reasons: string[] }
interface ScenarioPlan { planId: string; name: string; status: string; strategyKey: string; versionNumber: number }
interface ScenarioFact { id: string; factKey: string; valueSummary: string | null; sourceLabel: string | null; observedAt: string | null }
interface ScenarioExecution { id: string; planId: string; status: string; resultSummary: string | null; createdAt: string }
interface ScenarioTemplate { key: string; domain: string; name: string; description: string }
interface ScenarioRuntimeEvidence {
  availableFacts: string[]; missingFacts: string[]; readiness: Readiness;
  product: ConsumerReadinessProjection;
}

function strategyLabel(key: string): string { return PLAN_STRATEGIES.find((item) => item.key === key)?.label ?? key; }
function actionRoute(path: ConsumerActionPath): string | null {
  if (path === '/today') return '/(tabs)';
  if (path === '/connections') return '/(tabs)/connections';
  if (path === '/records') return '/(tabs)/records';
  return null;
}

export default function DomainScenarioPage() {
  const { domain, scenario } = useLocalSearchParams<{ domain: string; scenario: string }>();
  const token = useAuthStore((store) => store.token);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scenarioKey = domain && scenario ? `${domain}.${scenario}` : '';
  const definition = useQuery({ queryKey: ['scenario-definition', scenarioKey, token], queryFn: () => api<ScenarioDefinition>(`/scenarios/${scenarioKey}`, token), enabled: Boolean(scenarioKey && token) });
  const readiness = useQuery({ queryKey: ['scenario-readiness', scenarioKey, token], queryFn: () => api<Readiness>(`/scenarios/${scenarioKey}/readiness`, token), enabled: Boolean(scenarioKey && token) });
  const runtime = useQuery({ queryKey: ['scenario-runtime-evidence', scenarioKey, token], queryFn: async () => {
    const response = await api<{ runtime: ScenarioRuntimeEvidence }>(`/scenario-coverage-ledger/${scenarioKey}/runtime-evidence`, token);
    if (!isConsumerReadinessProjection(response?.runtime?.product)) throw new Error('场景可用状态契约无效');
    return response;
  }, enabled: Boolean(scenarioKey && token) });
  const plans = useQuery({ queryKey: ['scenario-plans', scenarioKey, token], queryFn: () => api<ScenarioPlan[]>(`/strategy-runtime/bindings?scenarioKey=${encodeURIComponent(scenarioKey)}`, token), enabled: Boolean(scenarioKey && token) });
  const facts = useQuery({ queryKey: ['scenario-truth', token], queryFn: () => api<ScenarioFact[]>('/truth-records', token), enabled: Boolean(token) });
  const executions = useQuery({ queryKey: ['scenario-executions', token], queryFn: () => api<ScenarioExecution[]>('/executions', token), enabled: Boolean(token && (plans.data?.length ?? 0) > 0) });
  const templates = useQuery({ queryKey: ['scenario-templates', token], queryFn: () => api<ScenarioTemplate[]>('/templates', token), enabled: Boolean(token) });
  const data = definition.data;
  const evidence = runtime.data?.runtime;
  const destination = actionRoute(evidence?.product.actionPath ?? null);
  const reasons = [...new Set((evidence?.readiness.reasons ?? readiness.data?.reasons ?? []).map(readinessReasonCopy))];
  const matchingFacts = (facts.data ?? []).filter((fact) => data?.requiredFacts.includes(fact.factKey));
  const planIds = new Set((plans.data ?? []).map((plan) => plan.planId));
  const recentExecutions = (executions.data ?? []).filter((item) => planIds.has(item.planId)).slice(0, 3);
  const matchingTemplates = (templates.data ?? []).filter((template) => template.domain === data?.domain).slice(0, 3);

  return <RuntimeDetailScreen title={data?.label ?? '场景详情'} subtitle="了解能帮你管理什么，以及现在还差哪一步" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={definition.isLoading || readiness.isLoading || runtime.isLoading} error={definition.isError || readiness.isError || runtime.isError} onRetry={() => { void definition.refetch(); void readiness.refetch(); void runtime.refetch(); }} loadingText="正在核对这个场景的真实状态…" /> : null}
    {token && data && evidence && readiness.data ? <>
      <View style={styles.hero}>
        <View style={styles.heroTop}><View style={styles.heroIcon}><Ionicons name="layers-outline" size={24} color={colors.primary} /></View><View style={styles.heroCopy}><Text style={styles.heroTitle}>{data.label}</Text><Text style={styles.heroKicker}>我的场景</Text></View></View>
        <View style={styles.status}><Ionicons name={evidence.product.userReadiness === 'READY' ? 'checkmark-circle' : 'alert-circle-outline'} size={18} color={evidence.product.userReadiness === 'READY' ? colors.success : colors.warning} /><Text style={styles.statusTitle}>{evidence.product.title}</Text></View>
        <Text style={styles.reason}>{evidence.product.reason}</Text>
        <View style={styles.next}><Text style={styles.nextLabel}>下一步</Text><Text style={styles.nextText}>{evidence.product.nextAction}</Text></View>
        {destination ? <Pressable accessibilityRole="button" onPress={() => router.push(destination as never)} style={styles.primaryAction}><Text style={styles.primaryActionText}>{evidence.product.nextAction}</Text><Ionicons name="arrow-forward" size={17} color="#FFFFFF" /></Pressable> : null}
      </View>
      <RuntimeSection title="它需要什么"><RuntimeCard>
        <RuntimeText>{evidence.missingFacts.length === 0 ? '所需事实类型已具备；是否可执行仍取决于授权、健康和风险检查。' : `还缺 ${evidence.missingFacts.length} 类事实，接入来源后才能继续判断。`}</RuntimeText>
        <View style={styles.metricRow}><View style={styles.metric}><Text style={styles.metricValue}>{evidence.availableFacts.length}</Text><Text style={styles.metricLabel}>已具备事实类型</Text></View><View style={styles.metric}><Text style={styles.metricValue}>{evidence.missingFacts.length}</Text><Text style={styles.metricLabel}>待补充事实类型</Text></View></View>
        {reasons.length > 0 ? <View style={styles.reasons}>{reasons.slice(0, 3).map((reason) => <Text key={reason} style={styles.reasonLine}>· {reason}</Text>)}</View> : null}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="当前事实"><RuntimeCard>{facts.isLoading ? <RuntimeText>正在读取已验证事实…</RuntimeText> : facts.isError ? <RuntimeText>事实暂时无法读取；不会把读取失败显示成“没有事实”。</RuntimeText> : matchingFacts.length === 0 ? <RuntimeText>还没有该场景所需的已验证事实。</RuntimeText> : matchingFacts.slice(0, 3).map((fact) => <Pressable accessibilityRole="button" key={fact.id} onPress={() => router.push(`/truth/${fact.id}` as never)} style={styles.listRow}><View style={styles.listCopy}><Text style={styles.listTitle}>{fact.valueSummary || fact.factKey}</Text><Text style={styles.listMeta}>{fact.sourceLabel || '来源未标注'} · {fact.observedAt ? displayTime(fact.observedAt) : '时间未记录'}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="目录支持的管理方式"><RuntimeCard>{data.supportedStrategies.length === 0 ? <RuntimeText>暂未提供管理方式。</RuntimeText> : data.supportedStrategies.map((strategy) => <Pressable accessibilityRole="button" key={strategy} onPress={() => router.push(`/strategies/${strategy}` as never)} style={styles.strategyRow}><Text style={styles.strategyName}>{strategyLabel(strategy)}</Text>{strategy === data.defaultStrategy ? <Text style={styles.defaultLabel}>默认</Text> : null}<Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="关联计划"><RuntimeCard>{plans.isLoading ? <RuntimeText>正在读取关联计划…</RuntimeText> : plans.isError ? <RuntimeText>暂时无法读取关联计划。</RuntimeText> : plans.data?.length === 0 ? <RuntimeText>还没有与这个场景建立运行时关联的计划。</RuntimeText> : plans.data?.map((plan) => <Pressable accessibilityRole="button" key={plan.planId} onPress={() => router.push(`/plans/${plan.planId}` as never)} style={styles.listRow}><View style={styles.listCopy}><Text style={styles.listTitle}>{plan.name}</Text><Text style={styles.listMeta}>{strategyLabel(plan.strategyKey)} · {planStatusLabel(plan.status)}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}<Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/plans' as never)} style={styles.linkRow}><Text style={styles.linkText}>查看全部计划</Text><Ionicons name="arrow-forward" size={16} color={colors.primary} /></Pressable></RuntimeCard></RuntimeSection>
      <RuntimeSection title="最近执行"><RuntimeCard>{plans.isLoading ? <RuntimeText>正在核对关联计划…</RuntimeText> : plans.isError ? <RuntimeText>关联计划暂时无法读取，因此不能判断该场景的执行记录。</RuntimeText> : plans.data?.length === 0 ? <RuntimeText>没有关联计划，因此还没有该场景的执行记录。</RuntimeText> : executions.isLoading ? <RuntimeText>正在读取最近执行…</RuntimeText> : executions.isError ? <RuntimeText>最近执行暂时无法读取。</RuntimeText> : recentExecutions.length === 0 ? <RuntimeText>最近的记录中还没有该场景的执行。</RuntimeText> : recentExecutions.map((execution) => <Pressable accessibilityRole="button" key={execution.id} onPress={() => router.push(`/executions/${execution.id}` as never)} style={styles.listRow}><View style={styles.listCopy}><Text style={styles.listTitle}>{execution.resultSummary || executionStatusLabel(execution.status)}</Text><Text style={styles.listMeta}>{displayTime(execution.createdAt)} · {executionStatusLabel(execution.status)}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="同领域模板"><RuntimeCard>{templates.isLoading ? <RuntimeText>正在读取模板…</RuntimeText> : templates.isError ? <RuntimeText>模板暂时无法读取。</RuntimeText> : matchingTemplates.length === 0 ? <RuntimeText>该领域暂未提供可参考的模板。</RuntimeText> : matchingTemplates.map((template) => <Pressable accessibilityRole="button" key={template.key} onPress={() => router.push(`/templates/${template.key}` as never)} style={styles.listRow}><View style={styles.listCopy}><Text style={styles.listTitle}>{template.name}</Text><Text style={styles.listMeta}>{template.description}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="运行边界"><Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={styles.disclosure}><Text style={styles.disclosureText}>{detailsOpen ? '收起技术依据' : '查看事实、能力与安全规则'}</Text><Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.primary} /></Pressable>
        {detailsOpen ? <RuntimeCard><RuntimeKeyValue label="所需事实" value={data.requiredFacts.join('、') || '未声明'} /><RuntimeKeyValue label="已具备事实" value={evidence.availableFacts.join('、') || '暂无'} /><RuntimeKeyValue label="来源能力" value={data.sourceRequirements.map((item) => item.capabilityKey).join('、') || '未声明'} /><RuntimeKeyValue label="动作能力" value={data.actionRequirements.map((item) => item.capabilityKey).join('、') || '未声明'} /><RuntimeKeyValue label="风险下限" value={data.defaultRiskFloor} /><RuntimeKeyValue label="未知结果处理" value={data.fallbackPolicy.unknown} last /><RuntimeText>实际执行、审批与验证由后端决定；本页只展示证据，不在手机上重新判断。</RuntimeText></RuntimeCard> : null}
      </RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  hero: { marginTop: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, heroIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 }, heroTitle: { ...typography.section, color: colors.text }, heroKicker: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, statusTitle: { ...typography.bodyStrong, color: colors.text },
  reason: { ...typography.body, color: colors.textSecondary, lineHeight: 21, marginTop: spacing.sm },
  next: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft }, nextLabel: { ...typography.caption, color: colors.primary, fontWeight: '700' }, nextText: { ...typography.bodyStrong, color: colors.text, marginTop: 3 },
  primaryAction: { marginTop: spacing.md, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, primaryActionText: { ...typography.bodyStrong, color: '#FFFFFF' },
  metricRow: { flexDirection: 'row', marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }, metric: { flex: 1 }, metricValue: { ...typography.section, color: colors.primary }, metricLabel: { ...typography.caption, color: colors.textSecondary },
  reasons: { marginTop: spacing.md }, reasonLine: { ...typography.caption, color: colors.textSecondary, lineHeight: 19 },
  strategyRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, strategyName: { ...typography.bodyStrong, color: colors.text, flex: 1 }, defaultLabel: { ...typography.caption, color: colors.primary },
  linkRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }, linkText: { ...typography.bodyStrong, color: colors.primary },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm }, listCopy: { flex: 1 }, listTitle: { ...typography.bodyStrong, color: colors.text }, listMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  disclosure: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, disclosureText: { ...typography.bodyStrong, color: colors.primary },
});
