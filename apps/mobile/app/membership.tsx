import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import {
  MEMBERSHIP_CAPABILITY_LABELS,
  activePlanUsageLabel,
  formatFileBytes,
  historyRetentionLabel,
  type MembershipSummary,
  type UsageSummary,
  usagePeriodLabel,
} from '../src/membership-presenter';
import { ShellPage, styles } from '../src/shell';

export default function MembershipPage() {
  const token = useAuthStore((state) => state.token);
  const membership = useQuery({
    queryKey: ['membership', token],
    queryFn: () => api<MembershipSummary>('/me/membership', token),
    enabled: Boolean(token),
  });
  const usage = useQuery({
    queryKey: ['monthly-usage', token],
    queryFn: () => api<UsageSummary>('/me/usage', token),
    enabled: Boolean(token),
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="会员" subtitle="这里只决定你可以使用哪些增强能力；撤销权限、断开账号和安全操作永远不会被套餐限制。">
        {membership.isLoading && <ActivityIndicator />}
        {membership.isError && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>会员信息暂时不可用</Text>
            <Text style={styles.cardText}>请稍后重试。你的安全入口和现有计划不会因此被修改。</Text>
            <View style={local.action}><Button title="重新加载" onPress={() => void membership.refetch()} /></View>
          </View>
        )}
        {membership.data && (
          <>
            <View style={[styles.card, local.hero]}>
              <Text style={local.planName}>{membership.data.membership.name}</Text>
              <Text style={styles.cardText}>{activePlanUsageLabel(membership.data)}</Text>
              <View style={local.progress}>
                <View style={[local.progressValue, { width: usageWidth(membership.data) }]} />
              </View>
              <Text style={local.quiet}>共有 {membership.data.usage.totalPlans} 个未归档计划</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>当前高级能力</Text>
              {MEMBERSHIP_CAPABILITY_LABELS.map(([key, label]) => (
                <View style={local.row} key={key}>
                  <Text style={local.rowLabel}>{label}</Text>
                  <Text style={membership.data.capabilities[key] ? local.enabled : local.disabled}>
                    {membership.data.capabilities[key] ? '已包含' : '未包含'}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>历史记录</Text>
              <Text style={styles.cardText}>{historyRetentionLabel(membership.data.limits.history_retention_days)}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{usage.data ? usagePeriodLabel(usage.data.periodStart) : '本月用量'}</Text>
              {usage.isLoading && <ActivityIndicator />}
              {usage.isError && (
                <>
                  <Text style={styles.cardText}>用量信息暂时不可用，不影响已有计划和安全操作。</Text>
                  <View style={local.action}><Button title="重新加载用量" onPress={() => void usage.refetch()} /></View>
                </>
              )}
              {usage.data && (
                <>
                  <UsageRow label="启用计划" value={usage.data.plan.active + ' / ' + usage.data.plan.limit} />
                  <UsageRow label="完成执行" value={String(usage.data.execution.completed)} />
                  <UsageRow label="高级 AI 输入" value={usage.data.advancedAi.inputUnits + ' 字符'} />
                  <UsageRow label="高级 AI 输出" value={usage.data.advancedAi.outputUnits + ' 字符'} />
                  <UsageRow label="连接器操作" value={String(usage.data.connector.operations)} />
                  <UsageRow label="通知送达" value={String(usage.data.notification.delivered)} />
                  <UsageRow label="导入文件" value={formatFileBytes(usage.data.storage.fileBytes)} />
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>升级</Text>
              <Text style={styles.cardText}>Plus 将提供更多启用计划额度和高级能力。真实支付尚未开放。</Text>
              <View style={local.action}><Button title="即将开放" disabled /></View>
            </View>

            <View style={local.safety}>
              <Text style={local.safetyTitle}>安全能力不受套餐限制</Text>
              <Text style={local.safetyText}>权限撤销、账号断开、审批、风险控制、安全记录、凭据撤销和数据管理始终可用。</Text>
            </View>
          </>
        )}
      </ShellPage>
    </ScrollView>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={local.row}>
      <Text style={local.rowLabel}>{label}</Text>
      <Text style={local.usageValue}>{value}</Text>
    </View>
  );
}

function usageWidth(summary: MembershipSummary): DimensionValue {
  const ratio = summary.limits.max_active_plans <= 0
    ? 0
    : Math.min(100, Math.round((summary.usage.activePlans / summary.limits.max_active_plans) * 100));
  return (ratio + '%') as DimensionValue;
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  hero: { borderColor: '#B9D8C9', backgroundColor: '#F8FFFB' },
  planName: { color: '#174E38', fontSize: 27, fontWeight: '800' },
  progress: { height: 8, backgroundColor: '#DFE8E3', borderRadius: 999, overflow: 'hidden', marginTop: 14 },
  progressValue: { height: 8, backgroundColor: '#287052', borderRadius: 999 },
  quiet: { color: '#7A8780', fontSize: 12, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF1EF' },
  rowLabel: { color: '#34463D' },
  enabled: { color: '#287052', fontWeight: '700' },
  disabled: { color: '#89948E' },
  usageValue: { color: '#174E38', fontWeight: '700' },
  action: { marginTop: 12 },
  safety: { backgroundColor: '#EAF5EF', borderRadius: 14, padding: 16, marginBottom: 20 },
  safetyTitle: { color: '#174E38', fontWeight: '800' },
  safetyText: { color: '#476157', lineHeight: 20, marginTop: 5 },
});
