import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Button, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { executionStatusLabel } from '../../src/execution-presenter';
import {
  actionSummary,
  automationLevelLabel,
  boolLabel,
  conditionSummary,
  formatTime,
  notificationPreferenceLabel,
  planCenterStatusLabel,
  planStatusLabel,
  platformLabel,
  sourceSummaryLabel,
  sourceTypeLabel,
  templateGroupLabel,
  triggerSummary,
} from '../../src/plan-presenter';
import type { TemplateConfigField } from '../../src/template-config-form';
import { planMutationErrorMessage } from '../../src/membership-presenter';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  missingConnections: Array<{ providerKey: string; providerName: string; requiredCapabilities: string[]; usedBy: string[] }>;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
  allowedTransitions: string[];
  currentVersion: { versionNumber: number; name: string; templateKey: string | null; templateVersion: string | null; templateConfig: Record<string, unknown> | null; automationLevel: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device';
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
    expectedReplaceAt?: string | null;
    remainingDays?: number | null;
    nearReplacement?: boolean;
    shoppingListPrepared?: boolean;
    consumableName?: string | null;
    deviceName?: string | null;
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

interface DeviceConsumable {
  id: string;
  deviceProfileId: string;
  name: string;
  lastReplacedAt: string;
  replacementIntervalDays: number;
  remindBeforeDays: number;
  expectedReplaceAt: string;
}

export default function PlanDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [replacementDate, setReplacementDate] = useState('');
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
  const deviceProfileId = typeof version.data?.templateConfig?.deviceProfileId === 'string' ? version.data.templateConfig.deviceProfileId : null;
  const deviceConsumableId = typeof version.data?.templateConfig?.consumableId === 'string' ? version.data.templateConfig.consumableId : null;
  const deviceConsumables = useQuery({
    queryKey: ['device-consumables', token, deviceProfileId],
    queryFn: () => api<DeviceConsumable[]>(
      `/device-consumables${deviceProfileId ? `?deviceProfileId=${encodeURIComponent(deviceProfileId)}` : ''}`,
      token,
    ),
    enabled: Boolean(token && summary.data?.planCenterSummary?.kind === 'device' && deviceProfileId),
  });
  const selectedConsumable = useMemo(
    () => deviceConsumables.data?.find((item) => item.id === deviceConsumableId) ?? null,
    [deviceConsumables.data, deviceConsumableId],
  );
  const apply = useMutation({
    mutationFn: () => api(`/plans/${id}/versions/${currentVersionNumber}/apply`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
      ]);
    },
  });
  const resolveConnections = useMutation({
    mutationFn: () => api<PlanSummary>(`/plans/${id}/connections/resolve`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
        client.invalidateQueries({ queryKey: ['plan-version', id] }),
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
  const updateReplacement = useMutation({
    mutationFn: () => {
      if (!deviceConsumableId) throw new Error('缺少耗材配置');
      return api(`/device-consumables/${deviceConsumableId}/replacement`, token, {
        method: 'PATCH',
        body: JSON.stringify({ lastReplacedAt: normalizeDateInput(replacementDate) }),
      });
    },
    onSuccess: async () => {
      setReplacementDate('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
        client.invalidateQueries({ queryKey: ['device-consumables', token, deviceProfileId] }),
      ]);
      await refreshAll();
    },
  });
  const refreshAll = async () => {
    await Promise.all([summary.refetch(), version.refetch(), template.refetch(), deviceConsumables.refetch()]);
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
            <Text style={local.cardTitle}>现在怎么样</Text>
            <Text style={local.text}>当前状态：{planStatusLabel(summary.data.status)}</Text>
            <Text style={local.text}>自动化等级：{automationLevelLabel(version.data.automationLevel)}</Text>
            <Text style={local.text}>下次预计运行：{formatTime(summary.data.nextExpectedRunAt)}</Text>
            <Text style={local.text}>最近一次执行：{summary.data.latestExecution ? `${formatTime(summary.data.latestExecution.createdAt)} · ${summary.data.latestExecution.resultSummary ?? executionStatusLabel(summary.data.latestExecution.status)}` : '暂未运行'}</Text>
            <Text style={local.text}>最近异常：{latestExceptionText(summary.data)}</Text>
          </View>

          {summary.data.planCenterSummary ? (
            <View style={local.card}>
              <Text style={local.cardTitle}>当前概况</Text>
              <Text style={local.text}>这条计划现在会这样帮你：{planCenterStatusLabel(summary.data.planCenterSummary.kind, summary.data.planCenterSummary.currentStatus)}</Text>
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
                  <Text style={local.text}>目标平台：{(summary.data.planCenterSummary.targetPlatforms ?? []).map((item) => platformLabel(item)).join('、') || '暂未设置'}</Text>
                  <Text style={local.text}>最近准备版本数：{summary.data.planCenterSummary.latestPreparedVariantCount ?? 0}</Text>
                  <Text style={local.text}>是否需要确认：{boolLabel(summary.data.planCenterSummary.waitingConfirmation)}</Text>
                  <Text style={local.text}>当前策略：{summary.data.planCenterSummary.currentStrategy ?? '仅准备草稿'}</Text>
                </>
              ) : null}
              {summary.data.planCenterSummary.kind === 'daily_summary' ? (
                <>
                  <Text style={local.text}>摘要时间：{summary.data.planCenterSummary.summaryTime ?? '暂未设置'}</Text>
                  <Text style={local.text}>数据来源：{(summary.data.planCenterSummary.includedSources ?? []).map((item) => sourceSummaryLabel(item)).join('、') || '暂未设置'}</Text>
                  <Text style={local.text}>最近摘要时间：{formatTime(summary.data.planCenterSummary.latestSummaryAt)}</Text>
                  <Text style={local.text}>最近重要事项数：{summary.data.planCenterSummary.latestImportantCount ?? 0}</Text>
                </>
              ) : null}
              {summary.data.planCenterSummary.kind === 'device' ? (
                <>
                  <Text style={local.text}>设备：{summary.data.planCenterSummary.deviceName ?? '未命名设备'}</Text>
                  <Text style={local.text}>耗材：{summary.data.planCenterSummary.consumableName ?? '未命名耗材'}</Text>
                  <Text style={local.text}>预计更换：{formatTime(summary.data.planCenterSummary.expectedReplaceAt)}</Text>
                  <Text style={local.text}>剩余时间：{typeof summary.data.planCenterSummary.remainingDays === 'number' ? `${Math.max(summary.data.planCenterSummary.remainingDays, 0)} 天` : '待计算'}</Text>
                  <Text style={local.text}>最近检查：{formatTime(summary.data.planCenterSummary.latestCheckAt)}</Text>
                  <Text style={local.text}>下次检查：{formatTime(summary.data.planCenterSummary.nextCheckAt)}</Text>
                  <Text style={local.text}>是否已准备购买清单：{boolLabel(summary.data.planCenterSummary.shoppingListPrepared)}</Text>
                  <Text style={local.text}>上次更换：{selectedConsumable ? formatTime(selectedConsumable.lastReplacedAt) : '暂未读取'}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={local.card}>
            <Text style={local.cardTitle}>它会替我做什么</Text>
            {version.data.definition.actions.map((action, index) => (
              <Text style={local.text} key={`${action.actionType}-${index}`}>{index + 1}. {actionSummary(action.actionType, action.config)}</Text>
            ))}
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>什么时候会叫我</Text>
            <Text style={local.text}>{notificationText(version.data)}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>当前设置</Text>
            {renderConfig(version.data.templateConfig, template.data?.configFields)}
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>数据来源</Text>
            {version.data.definition.sources.map((source, index) => (
              <Text style={local.text} key={`${source.sourceType}-${index}`}>
                {index + 1}. {sourceTypeLabel(source.sourceType)}{source.connectionId ? ' · 已完成连接设置' : ''}
              </Text>
            ))}
            <Text style={local.cardTitle}>当前权限</Text>
            <Text style={local.text}>{summary.data.hasMissingConnection ? '还有连接或授权没补齐，暂时不能稳定运行。' : '当前所需连接和授权都已经满足。'}</Text>
            {summary.data.missingConnections.map((connection) => (
              <Text style={local.text} key={connection.providerKey}>· 还需要：{connection.providerName}</Text>
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

          {summary.data.missingConnections.length > 0 ? (
            <View style={local.card}>
              <Text style={local.cardTitle}>还差 {summary.data.missingConnections.length} 个连接</Text>
              <Text style={local.text}>计划草稿已经保留。补好连接后再启用，不会删除你已经设置的内容。</Text>
              {summary.data.missingConnections.map((connection) => (
                <Text style={local.text} key={connection.providerKey}>· {connection.providerName}</Text>
              ))}
              <View style={local.buttonGap} />
              <Button title="去补连接" onPress={() => router.push('/connections')} />
              <View style={local.buttonGap} />
              <Button title={resolveConnections.isPending ? '检查中…' : '我已连接，重新检查'} onPress={() => resolveConnections.mutate()} disabled={resolveConnections.isPending} />
              {resolveConnections.isError ? <Text style={local.error}>还没有找到可用连接，请先完成连接与授权。</Text> : null}
            </View>
          ) : null}

          {summary.data.planCenterSummary?.kind === 'device' && deviceConsumableId ? (
            <View style={local.card}>
              <Text style={local.cardTitle}>更新已更换时间</Text>
              <Text style={local.text}>更换完耗材后，在这里更新日期，系统会重新计算预计更换时间和后续提醒。</Text>
              <TextInput
                style={local.input}
                placeholder="YYYY-MM-DD"
                value={replacementDate}
                onChangeText={setReplacementDate}
              />
              <Button
                title={updateReplacement.isPending ? '更新中…' : '确认已更换'}
                onPress={() => updateReplacement.mutate()}
                disabled={updateReplacement.isPending || !replacementDate.trim()}
              />
              {updateReplacement.isError ? <Text style={local.error}>更新失败，请检查日期格式后重试。</Text> : null}
            </View>
          ) : null}

          <View style={local.card}>
            <Text style={local.cardTitle}>管理这条计划</Text>
            <Button title="编辑" onPress={() => router.push(`/plans/${id}/edit` as never)} />
            <View style={local.buttonGap} />
            <Button
              title={apply.isPending ? '启用中…' : '启用这次修改'}
              onPress={() => apply.mutate()}
              disabled={apply.isPending || !currentVersionNumber || summary.data.hasMissingConnection}
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
            {apply.isError || changeStatus.isError ? <Text style={local.error}>{planMutationErrorMessage(changeStatus.error ?? apply.error)}</Text> : null}
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>高级信息</Text>
            <Text style={local.text}>来自模板：{template.data?.name ?? '已安装模板'}{summary.data.templateVersion ? ` · V${summary.data.templateVersion}` : ''}</Text>
            <Text style={local.text}>当前修改稿：V{version.data.versionNumber}</Text>
            <Text style={local.text}>当前运行版本：{summary.data.activeVersion ? `V${summary.data.activeVersion.versionNumber}` : '还没有正式启用'}</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  return trimmed;
}

function renderConfig(config: Record<string, unknown> | null, fields: TemplateConfigField[] | undefined) {
  if (!config || Object.keys(config).length === 0) return <Text style={local.text}>当前版本没有额外模板配置。</Text>;
  const visibleEntries = Object.entries(config).flatMap(([key, value]) => {
    const field = fields?.find((item) => item.key === key);
    if (!field) {
      return [];
    }
    return [(
      <Text style={local.text} key={key}>
        {field.label}：{formatConfigValue(field, value)}
      </Text>
    )];
  });
  return visibleEntries.length > 0 ? visibleEntries : <Text style={local.text}>当前版本已配置完成。</Text>;
}

function formatConfigValue(field: TemplateConfigField, value: unknown) {
  if (Array.isArray(value)) {
    const labels = value.map((item) => optionLabel(field, item)).filter(Boolean);
    return labels.length > 0 ? labels.join('、') : '已配置';
  }
  if (typeof value === 'boolean') return boolLabel(value);
  if (field.key === 'notificationPreference') return notificationPreferenceLabel(value);
  if (field.key === 'group') return templateGroupLabel(String(value));
  if (field.type === 'select' || field.type === 'multiselect') return optionLabel(field, value);
  if (field.type === 'date' || field.type === 'time') return String(value);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '已配置';
}

function optionLabel(field: TemplateConfigField, value: unknown) {
  const matched = field.options?.find((option) => option.value === String(value));
  return matched?.label ?? '已配置';
}

function notificationText(version: PlanVersionDetail) {
  const notifyAction = version.definition.actions.find((item) => item.actionType === 'notify');
  if (!notifyAction) return '默认静默，结果只进入记录。';
  if (typeof version.templateConfig?.notificationPreference !== 'undefined') {
    return `按“${notificationPreferenceLabel(version.templateConfig.notificationPreference)}”处理。`;
  }
  return actionSummary('notify', notifyAction.config);
}

function latestExceptionText(summary: PlanSummary) {
  if (!summary.latestExecution) return '最近没有发现异常。';
  if (summary.latestExecution.status === 'failed') return summary.latestExecution.resultSummary ?? '上一次运行没有成功完成。';
  if (summary.hasMissingConnection) return '当前缺少连接或授权，需要先补齐。';
  return '最近没有发现异常。';
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
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#FAFBFA', marginTop: 10, marginBottom: 10 },
  buttonGap: { height: 10 },
  error: { color: '#A63D3D', marginTop: 10 },
});
