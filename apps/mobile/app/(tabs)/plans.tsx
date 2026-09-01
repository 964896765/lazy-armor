import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { formatTime, planGroup, planStatusLabel, type PlanListStatus } from '../../src/plan-presenter';
import { styles } from '../../src/shell';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
  currentVersion: { versionNumber: number; name: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary';
    currentStatus: string;
    latestCheckAt?: string | null;
    nextCheckAt?: string | null;
    isException?: boolean;
    estimatedRunOutAt?: string | null;
    nextReminderAt?: string | null;
    targetPlatforms?: string[];
    latestPreparedVariantCount?: number;
    waitingConfirmation?: boolean;
    summaryTime?: string | null;
    includedSources?: string[];
    latestSummaryAt?: string | null;
    latestImportantCount?: number;
  } | null;
}

export default function Plans() {
  const token = useAuthStore((state) => state.token);
  const plans = useQuery({
    queryKey: ['plans', token],
    queryFn: () => api<PlanSummary[]>('/plans', token),
    enabled: Boolean(token),
  });
  const grouped: Record<PlanListStatus, PlanSummary[]> = {
    运行中: [],
    需要设置: [],
    已暂停: [],
  };
  for (const plan of plans.data ?? []) {
    grouped[planGroup(plan.status)].push(plan);
  }

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={token ? <RefreshControl refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
    >
      <Text style={styles.eyebrow}>懒人装甲 · P1</Text>
      <Text style={styles.title}>我的计划</Text>
      <Text style={styles.subtitle}>先看哪些计划正在替你跑，哪些还差一步配置完成。</Text>
      {!token && <View style={styles.card}><Text style={styles.cardTitle}>登录后查看真实计划</Text><Text style={styles.cardText}>请先在“我的连接”完成登录。</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>}
      {plans.isLoading && <ActivityIndicator />}
      {plans.isError && <Text style={local.error}>计划读取失败，请稍后重试。</Text>}
      {plans.data?.length === 0 && <View style={styles.card}><Text style={styles.cardTitle}>暂未创建计划</Text><Text style={styles.cardText}>可从“＋”进入懒人计划库，装上一个正式模板。</Text></View>}
      {(['运行中', '需要设置', '已暂停'] as PlanListStatus[]).map((group) => (
        <View key={group}>
          <Text style={local.groupTitle}>{group}</Text>
          {grouped[group].length === 0 ? <Text style={local.empty}>这一组目前还没有计划。</Text> : null}
          {grouped[group].map((plan) => (
            <Pressable key={plan.id} onPress={() => router.push(`/plans/${plan.id}` as never)}>
              <View style={styles.card}>
                <View style={local.headingRow}><Text style={styles.cardTitle}>{plan.name ?? '未命名计划'}</Text><Text style={local.state}>{planStatusLabel(plan.status)}</Text></View>
                {plan.description ? <Text style={styles.cardText}>{plan.description}</Text> : null}
                {plan.planCenterSummary?.kind === 'logistics' ? (
                  <>
                    <Text style={styles.cardText}>当前状态：{plan.planCenterSummary.currentStatus}{plan.planCenterSummary.isException ? ' · 需要留意' : ''}</Text>
                    <Text style={styles.cardText}>最近检查：{formatTime(plan.planCenterSummary.latestCheckAt ?? plan.latestExecution?.createdAt)}</Text>
                    <Text style={styles.cardText}>下次检查：{formatTime(plan.planCenterSummary.nextCheckAt ?? plan.nextExpectedRunAt)}</Text>
                  </>
                ) : null}
                {plan.planCenterSummary?.kind === 'household' ? (
                  <>
                    <Text style={styles.cardText}>当前状态：{plan.planCenterSummary.currentStatus}</Text>
                    <Text style={styles.cardText}>预计耗尽：{formatTime(plan.planCenterSummary.estimatedRunOutAt)}</Text>
                    <Text style={styles.cardText}>下次提醒：{formatTime(plan.planCenterSummary.nextReminderAt)}</Text>
                  </>
                ) : null}
                {plan.planCenterSummary?.kind === 'content' ? (
                  <>
                    <Text style={styles.cardText}>目标平台：{(plan.planCenterSummary.targetPlatforms ?? []).join('、') || '暂未设置'}</Text>
                    <Text style={styles.cardText}>最近准备：{plan.planCenterSummary.latestPreparedVariantCount ?? 0} 个版本</Text>
                    <Text style={styles.cardText}>是否等待确认：{plan.planCenterSummary.waitingConfirmation ? '是' : '否'}</Text>
                  </>
                ) : null}
                {plan.planCenterSummary?.kind === 'daily_summary' ? (
                  <>
                    <Text style={styles.cardText}>摘要时间：{plan.planCenterSummary.summaryTime ?? '暂未设置'}</Text>
                    <Text style={styles.cardText}>数据来源：{(plan.planCenterSummary.includedSources ?? []).join('、') || '暂未设置'}</Text>
                    <Text style={styles.cardText}>最近重点事项：{plan.planCenterSummary.latestImportantCount ?? 0} 件</Text>
                  </>
                ) : null}
                <Text style={styles.cardText}>最近执行：{plan.latestExecution ? `${formatTime(plan.latestExecution.createdAt)} · ${plan.latestExecution.resultSummary ?? plan.latestExecution.status}` : '暂未运行'}</Text>
                <Text style={styles.cardText}>下次预计运行：{formatTime(plan.nextExpectedRunAt)}</Text>
                <Text style={styles.cardText}>连接/配置：{plan.hasMissingConnection ? '还缺连接或权限' : '已具备当前所需数据'}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 24, paddingTop: 52 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  state: { color: '#287052', fontWeight: '700' },
  error: { color: '#A63D3D', marginBottom: 12 },
  groupTitle: { fontSize: 18, fontWeight: '800', color: '#24342C', marginTop: 12, marginBottom: 10 },
  empty: { color: '#6B7770', marginBottom: 12 },
});
