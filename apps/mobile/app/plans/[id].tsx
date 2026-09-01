import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Button, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import {
  actionSummary,
  automationLevelLabel,
  boolLabel,
  conditionSummary,
  formatTime,
  notificationPreferenceLabel,
  planStatusLabel,
  sourceTypeLabel,
  triggerSummary,
} from '../../src/plan-presenter';
import type { TemplateConfigField } from '../../src/template-config-form';

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
  allowedTransitions: string[];
  currentVersion: { versionNumber: number; name: string; templateKey: string | null; templateVersion: string | null; templateConfig: Record<string, unknown> | null; automationLevel: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary';
    currentStatus: string;
    latestCheckAt?: string | null;
    nextCheckAt?: string | null;
    isException?: boolean;
    latestEventSummary?: string | null;
    estimatedRunOutAt?: string | null;
    nextReminderAt?: string | null;
    targetPlatforms?: string[];
    latestPreparedVariantCount?: number;
    waitingConfirmation?: boolean;
    currentStrategy?: string;
    summaryTime?: string | null;
    includedSources?: string[];
    latestSummaryAt?: string | null;
    latestImportantCount?: number;
  } | null;
}

interface PlanVersionDetail {
  id: string;
  versionNumber: number;
  name: string;
  description: string | null;
  domain: string;
  automationLevel: string;
  templateKey: string | null;
  templateVersion: string | null;
  templateConfig: Record<string, unknown> | null;
  definition: {
    sources: Array<{ sourceType: string; connectorKey?: string | null; connectionId?: string | null; config: Record<string, unknown> }>;
    triggers: Array<{ triggerType: string; config: Record<string, unknown>; sortOrder: number }>;
    conditions: Array<{ fieldPath: string; operator: string; comparisonValue?: unknown; sortOrder: number }>;
    actions: Array<{ actionType: string; config: Record<string, unknown>; stepOrder: number }>;
  };
}

interface TemplateDetail {
  name: string;
  configFields: TemplateConfigField[];
}

export default function PlanDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const summary = useQuery({
    queryKey: ['plan', id, token],
    queryFn: () => api<PlanSummary>(`/plans/${id}`, token),
    enabled: Boolean(id && token),
  });
  const currentVersionNumber = summary.data?.currentVersion?.versionNumber;
  const version = useQuery({
    queryKey: ['plan-version', id, currentVersionNumber, token],
    queryFn: () => api<PlanVersionDetail>(`/plans/${id}/versions/${currentVersionNumber}`, token),
    enabled: Boolean(id && token && currentVersionNumber),
  });
  const template = useQuery({
    queryKey: ['template-detail', summary.data?.templateKey, token],
    queryFn: () => api<TemplateDetail>(`/templates/${summary.data?.templateKey}`, token),
    enabled: Boolean(token && summary.data?.templateKey),
  });
  const apply = useMutation({
    mutationFn: () => api(`/plans/${id}/versions/${currentVersionNumber}/apply`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
      ]);
    },
  });
  const changeStatus = useMutation({
    mutationFn: (status: string) => api(`/plans/${id}/status`, token, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
      ]);
    },
  });
  const refreshAll = async () => {
    await Promise.all([summary.refetch(), version.refetch(), template.refetch()]);
  };

  if (!token) {
    return (
      <ScrollView style={local.page} contentContainerStyle={local.content}>
        <View style={local.card}>
          <Text style={local.title}>请先登录</Text>
          <Text style={local.text}>登录后才能查看计划详情。</Text>
          <Button title="去登录" onPress={() => router.push('/connections')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={summary.isFetching || version.isFetching} onRefresh={refreshAll} />}
    >
      {(summary.isLoading || version.isLoading) && <ActivityIndicator />}
      {summary.isError && (
        <View style={local.card}>
          <Text style={local.title}>计划详情加载失败</Text>
          <Button title="重新加载" onPress={refreshAll} />
        </View>
      )}
      {summary.data && version.data && (
        <>
          <Text style={local.eyebrow}>我的计划</Text>
          <Text style={local.title}>{summary.data.name ?? version.data.name}</Text>
          <Text style={local.subtitle}>{summary.data.description ?? version.data.description ?? '这是一份可持续运行的懒人计划。'}</Text>

          <View style={local.card}>
            <Text style={local.cardTitle}>当前状态</Text>
            <Text style={local.text}>状态：{planStatusLabel(summary.data.status)}</Text>
            <Text style={local.text}>自动化等级：{automationLevelLabel(version.data.automationLevel)}</Text>
            <Text style={local.text}>来自模板：{template.data?.name ?? summary.data.templateKey ?? '手工计划'}{summary.data.templateVersion ? ` · V${summary.data.templateVersion}` : ''}</Text>
            <Text style={local.text}>当前版本：V{version.data.versionNumber}</Text>
            <Text style={local.text}>生效版本：{summary.data.activeVersion ? `V${summary.data.activeVersion.versionNumber}` : '尚未 Apply'}</Text>
            <Text style={local.text}>下次预计运行：{formatTime(summary.data.nextExpectedRunAt)}</Text>
            <Text style={local.text}>最近一次执行：{summary.data.latestExecution ? `${formatTime(summary.data.latestExecution.createdAt)} · ${summary.data.latestExecution.resultSummary ?? summary.data.latestExecution.status}` : '暂未运行'}</Text>
          </View>

          {summary.data.planCenterSummary ? (
            <View style={local.card}>
              <Text style={local.cardTitle}>当前概况</Text>
              <Text style={local.text}>当前状态：{summary.data.planCenterSummary.currentStatus}</Text>
              {summary.data.planCenterSummary.kind === 'logistics' ? (
                <>
                  <Text style={local.text}>最近检查：{formatTime(summary.data.planCenterSummary.latestCheckAt)}</Text>
                  <Text style={local.text}>下次检查：{formatTime(summary.data.planCenterSummary.nextCheckAt)}</Text>
                  <Text style={local.text}>是否异常：{boolLabel(summary.data.planCenterSummary.isException)}</Text>
                  {summary.data.planCenterSummary.latestEventSummary ? <Text style={local.text}>最近进展：{summary.data.planCenterSummary.latestEventSummary}</Text> : null}
                </>
              ) : null}
              {summary.data.planCenterSummary.kind === 'household' ? (
                <>
                  <Text style={local.text}>预计耗尽：{formatTime(summary.data.planCenterSummary.estimatedRunOutAt)}</Text>
                  <Text style={local.text}>下次提醒：{formatTime(summary.data.planCenterSummary.nextReminderAt)}</Text>
                  <Text style={local.text}>下次检查：{formatTime(summary.data.planCenterSummary.nextCheckAt)}</Text>
                </>
              ) : null}
              {summary.data.planCenterSummary.kind === 'content' ? (
                <>
                  <Text style={local.text}>目标平台：{(summary.data.planCenterSummary.targetPlatforms ?? []).join('、') || '暂未设置'}</Text>
                  <Text style={local.text}>最近准备版本数：{summary.data.planCenterSummary.latestPreparedVariantCount ?? 0}</Text>
                  <Text style={local.text}>是否需要确认：{boolLabel(summary.data.planCenterSummary.waitingConfirmation)}</Text>
                  <Text style={local.text}>当前策略：{summary.data.planCenterSummary.currentStrategy ?? '仅准备草稿'}</Text>
                </>
              ) : null}
              {summary.data.planCenterSummary.kind === 'daily_summary' ? (
                <>
                  <Text style={local.text}>摘要时间：{summary.data.planCenterSummary.summaryTime ?? '暂未设置'}</Text>
                  <Text style={local.text}>数据来源：{(summary.data.planCenterSummary.includedSources ?? []).join('、') || '暂未设置'}</Text>
                  <Text style={local.text}>最近摘要时间：{formatTime(summary.data.planCenterSummary.latestSummaryAt)}</Text>
                  <Text style={local.text}>最近重要事项数：{summary.data.planCenterSummary.latestImportantCount ?? 0}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={local.card}>
            <Text style={local.cardTitle}>当前配置</Text>
            {renderConfig(version.data.templateConfig, template.data?.configFields)}
            <Text style={local.text}>连接与权限：{summary.data.hasMissingConnection ? '还缺连接或权限，需要继续设置。' : '当前所需连接已满足。'}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>数据来源</Text>
            {version.data.definition.sources.map((source, index) => (
              <Text style={local.text} key={`${source.sourceType}-${index}`}>
                {index + 1}. {sourceTypeLabel(source.sourceType)}{source.connectorKey ? ` · ${source.connectorKey}` : ''}{source.connectionId ? ' · 已绑定连接' : ''}
              </Text>
            ))}
            <Text style={local.cardTitle}>运行条件</Text>
            {version.data.definition.triggers.map((trigger, index) => (
              <Text style={local.text} key={`${trigger.triggerType}-${index}`}>{index + 1}. {triggerSummary(trigger.triggerType, trigger.config)}</Text>
            ))}
            {version.data.definition.conditions.length === 0 ? <Text style={local.text}>无额外门槛，到点就执行。</Text> : null}
            {version.data.definition.conditions.map((condition, index) => (
              <Text style={local.text} key={`${condition.fieldPath}-${index}`}>{index + 1}. {conditionSummary(condition.fieldPath, condition.operator, condition.comparisonValue)}</Text>
            ))}
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>会执行什么</Text>
            {version.data.definition.actions.map((action, index) => (
              <Text style={local.text} key={`${action.actionType}-${index}`}>{index + 1}. {actionSummary(action.actionType, action.config)}</Text>
            ))}
            <Text style={local.cardTitle}>什么时候通知</Text>
            <Text style={local.text}>{notificationText(version.data)}</Text>
          </View>

          <View style={local.card}>
            <Button title="编辑" onPress={() => router.push(`/plans/${id}/edit` as never)} />
            <View style={local.buttonGap} />
            <Button
              title={apply.isPending ? 'Apply 中…' : '启用 / Apply 当前版本'}
              onPress={() => apply.mutate()}
              disabled={apply.isPending || !currentVersionNumber}
            />
            {summary.data.allowedTransitions.map((status) => (
              <View style={local.buttonGap} key={status}>
                <Button
                  title={statusActionLabel(status)}
                  onPress={() => changeStatus.mutate(status)}
                  disabled={changeStatus.isPending}
                  color={status === 'archived' ? '#9A3F3F' : undefined}
                />
              </View>
            ))}
            {apply.isError || changeStatus.isError ? <Text style={local.error}>操作失败，请稍后重试。</Text> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function renderConfig(config: Record<string, unknown> | null, fields: TemplateConfigField[] | undefined) {
  if (!config || Object.keys(config).length === 0) return <Text style={local.text}>当前版本没有额外模板配置。</Text>;
  return Object.entries(config).map(([key, value]) => {
    const field = fields?.find((item) => item.key === key);
    return (
      <Text style={local.text} key={key}>
        {(field?.label ?? key)}：{formatConfigValue(key, value)}
      </Text>
    );
  });
}

function formatConfigValue(key: string, value: unknown) {
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return boolLabel(value);
  if (key === 'notificationPreference') return notificationPreferenceLabel(value);
  return String(value);
}

function notificationText(version: PlanVersionDetail) {
  const notifyAction = version.definition.actions.find((item) => item.actionType === 'notify');
  if (!notifyAction) return '默认静默，结果只进入记录。';
  if (typeof version.templateConfig?.notificationPreference !== 'undefined') {
    return `按“${notificationPreferenceLabel(version.templateConfig.notificationPreference)}”处理。`;
  }
  return actionSummary('notify', notifyAction.config);
}

function statusActionLabel(status: string) {
  switch (status) {
    case 'ready':
      return '标记为已准备';
    case 'active':
      return '开始运行';
    case 'paused':
      return '暂停';
    case 'archived':
      return '归档';
    case 'draft':
      return '回到草稿';
    default:
      return `切换到 ${planStatusLabel(status)}`;
  }
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 24, paddingTop: 52 },
  eyebrow: { color: '#287052', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#17251F', fontSize: 30, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#69756F', fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E3E7E4' },
  cardTitle: { fontWeight: '700', fontSize: 16, color: '#24342C', marginTop: 10, marginBottom: 4 },
  text: { color: '#6B7770', lineHeight: 21 },
  buttonGap: { height: 10 },
  error: { color: '#A63D3D', marginTop: 10 },
});
