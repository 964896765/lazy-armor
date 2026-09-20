import { PLAN_STRATEGIES } from '@lazy-armor/plan-schema/mobile';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { colors, radius, spacing, typography } from '../../../src/design';
import { readinessReasonCopy } from '../../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

interface ScenarioDefinition {
  key: string; domain: string; label: string; revision: number; status: string;
  requiredFacts: string[]; supportedStrategies: string[]; defaultStrategy: string;
  sourceRequirements: Array<{ capabilityKey: string }>;
  actionRequirements: Array<{ capabilityKey: string }>;
  defaultRiskFloor: string; fallbackPolicy: { unknown: string };
}
interface Readiness { reasons: string[] }
interface ScenarioRuntimeEvidence {
  availableFacts: string[]; missingFacts: string[]; readiness: Readiness;
  product: { userReadiness: string; title: string; reason: string; nextAction: string; actionPath: '/connections' | '/today' | '/records' | null };
}

function strategyLabel(key: string): string { return PLAN_STRATEGIES.find((item) => item.key === key)?.label ?? key; }
function actionRoute(path: ScenarioRuntimeEvidence['product']['actionPath']): string | null {
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
  const runtime = useQuery({ queryKey: ['scenario-runtime-evidence', scenarioKey, token], queryFn: () => api<{ runtime: ScenarioRuntimeEvidence }>(`/scenario-coverage-ledger/${scenarioKey}/runtime-evidence`, token), enabled: Boolean(scenarioKey && token) });
  const data = definition.data;
  const evidence = runtime.data?.runtime;
  const destination = actionRoute(evidence?.product.actionPath ?? null);
  const reasons = [...new Set((evidence?.readiness.reasons ?? readiness.data?.reasons ?? []).map(readinessReasonCopy))];

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
      <RuntimeSection title="目录支持的管理方式"><RuntimeCard>{data.supportedStrategies.length === 0 ? <RuntimeText>暂未提供管理方式。</RuntimeText> : data.supportedStrategies.map((strategy) => <Pressable accessibilityRole="button" key={strategy} onPress={() => router.push(`/strategies/${strategy}` as never)} style={styles.strategyRow}><Text style={styles.strategyName}>{strategyLabel(strategy)}</Text>{strategy === data.defaultStrategy ? <Text style={styles.defaultLabel}>默认</Text> : null}<Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="我的计划"><RuntimeCard><RuntimeText>已创建的计划以计划列表为准。此处不把场景目录当作你已启用的计划。</RuntimeText><Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/plans' as never)} style={styles.linkRow}><Text style={styles.linkText}>查看全部计划</Text><Ionicons name="arrow-forward" size={16} color={colors.primary} /></Pressable></RuntimeCard></RuntimeSection>
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
  disclosure: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, disclosureText: { ...typography.bodyStrong, color: colors.primary },
});
