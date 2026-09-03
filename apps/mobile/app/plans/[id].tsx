import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { executionStatusLabel } from '../../src/execution-presenter';
import {
  actionSummary,
  boolLabel,
  conditionSummary,
  formatTime,
  notificationPreferenceLabel,
  planCenterStatusLabel,
  planStatusLabel,
  sourceTypeLabel,
  templateGroupLabel,
  triggerSummary,
} from '../../src/plan-presenter';
import type { TemplateConfigField } from '../../src/template-config-form';
import { planMutationErrorMessage } from '../../src/membership-presenter';
import { ActionButton, AttentionCard, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';

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
  const [settingsExpanded, setSettingsExpanded] = useState(false);
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

  if (!token) return (
    <SafeAreaView style={local.safeArea} edges={['top']}>
      <Surface><EmptyState icon="🛡️" title="登录后查看计划详情" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={local.safeArea} edges={['top']}>
      <ScrollView style={local.page} contentContainerStyle={local.content} refreshControl={<RefreshControl tintColor={colors.primary} refreshing={summary.isFetching || version.isFetching} onRefresh={refreshAll} />}>
        {(summary.isLoading || version.isLoading) ? <View style={local.loading}><ActivityIndicator color={colors.primary} /><Text style={local.text}>正在看看这条计划…</Text></View> : null}
        {summary.isError ? <Surface><EmptyState icon="☁️" title="计划暂时加载失败" description="请稍后再试。" action={{ label: '重新加载', onPress: refreshAll }} /></Surface> : null}
        {summary.data && version.data ? (
          <>
            <View style={local.hero}>
              <View style={local.heroIcon}><Text style={local.heroEmoji}>{planDetailIcon(summary.data.planCenterSummary?.kind)}</Text></View>
              <Text style={local.eyebrow}>{planStatusLabel(summary.data.status)}</Text>
              <Text style={local.title}>{summary.data.name ?? version.data.name}</Text>
              <Text style={local.subtitle}>{summary.data.description ?? version.data.description ?? '这件事会按你的安排持续运行。'}</Text>
            </View>

            <Text style={local.sectionTitle}>它正在帮你</Text>
            <Surface>
              <View style={local.helpSteps}>
                {version.data.definition.triggers.map((trigger, index) => <HelpStep key={`${trigger.triggerType}-${index}`} icon="◷" text={triggerSummary(trigger.triggerType, trigger.config)} />)}
                {version.data.definition.actions.map((action, index) => <HelpStep key={`${action.actionType}-${index}`} icon="✓" text={actionSummary(action.actionType, action.config)} />)}
                <HelpStep icon="→" text={summary.data.nextExpectedRunAt ? `下一次预计在 ${formatTime(summary.data.nextExpectedRunAt)}` : '下一次时间正在安排'} />
              </View>
            </Surface>

            <Text style={local.sectionTitle}>使用的信息</Text>
            <Surface>
              <View style={local.sourceList}>
                {version.data.definition.sources.map((source, index) => (
                  <View style={local.sourceChip} key={`${source.sourceType}-${index}`}><Text style={local.sourceText}>{sourceTypeLabel(source.sourceType)}</Text></View>
                ))}
              </View>
              <Text style={local.permissionText}>{summary.data.hasMissingConnection ? '还差一个连接，补好后就能继续。' : '只使用完成这条计划所需的信息。'}</Text>
            </Surface>

            <Text style={local.sectionTitle}>最近结果</Text>
            <Surface>
              <Text style={local.resultDate}>{summary.data.latestExecution ? formatTime(summary.data.latestExecution.createdAt) : '还没有运行记录'}</Text>
              <Text style={local.resultTitle}>{summary.data.latestExecution?.resultSummary ?? (summary.data.planCenterSummary ? planCenterStatusLabel(summary.data.planCenterSummary.kind, summary.data.planCenterSummary.currentStatus) : '第一次运行后，结果会出现在这里。')}</Text>
              {summary.data.latestExecution ? <View style={local.inlineAction}><ActionButton label="查看完整记录" tone="quiet" onPress={() => router.push(`/executions/${summary.data?.latestExecution?.id}` as never)} /></View> : null}
            </Surface>

            {summary.data.missingConnections.length > 0 ? (
              <View style={local.sectionGap}>
                <AttentionCard
                  title={`还需要连接 ${summary.data.missingConnections.map((item) => item.providerName).join('、')}`}
                  description="计划已经替你保留，连接完成后就能继续运行。"
                  actionLabel="去连接"
                  onPress={() => router.push('/connections')}
                  secondaryAction={{ label: resolveConnections.isPending ? '检查中…' : '重新检查', onPress: () => resolveConnections.mutate() }}
                />
                {resolveConnections.isError ? <Text style={local.error}>还没有找到可用连接，请先完成授权。</Text> : null}
              </View>
            ) : null}

            <Pressable accessibilityRole="button" accessibilityState={{ expanded: settingsExpanded }} onPress={() => setSettingsExpanded((current) => !current)} style={local.settingsHeader}>
              <View><Text style={local.sectionTitleNoMargin}>设置</Text><Text style={local.settingsHint}>通知、运行条件与计划管理</Text></View>
              <Text style={local.chevron}>{settingsExpanded ? '⌃' : '⌄'}</Text>
            </Pressable>

            {settingsExpanded ? (
              <View style={local.settingsContent}>
                <Surface>
                  <Text style={local.cardTitle}>什么时候会告诉你</Text>
                  <Text style={local.text}>{notificationText(version.data)}</Text>
                  <Text style={local.cardTitle}>运行条件</Text>
                  {version.data.definition.conditions.length === 0 ? <Text style={local.text}>到点就按计划处理。</Text> : null}
                  {version.data.definition.conditions.map((condition, index) => <Text style={local.text} key={`${condition.fieldPath}-${index}`}>{conditionSummary(condition.fieldPath, condition.operator, condition.comparisonValue)}</Text>)}
                  <Text style={local.cardTitle}>当前设置</Text>
                  {renderConfig(version.data.templateConfig, template.data?.configFields)}
                </Surface>

                {summary.data.planCenterSummary?.kind === 'device' && deviceConsumableId ? (
                  <Surface>
                    <Text style={local.cardTitle}>更新耗材更换时间</Text>
                    <Text style={local.text}>更换后告诉我日期，后续提醒会重新计算。</Text>
                    <TextInput style={local.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={replacementDate} onChangeText={setReplacementDate} />
                    <ActionButton label={updateReplacement.isPending ? '更新中…' : '确认已更换'} onPress={() => updateReplacement.mutate()} disabled={updateReplacement.isPending || !replacementDate.trim()} />
                    {updateReplacement.isError ? <Text style={local.error}>日期没有更新成功，请检查后重试。</Text> : null}
                  </Surface>
                ) : null}

                <Surface>
                  <Text style={local.cardTitle}>管理这条计划</Text>
                  <View style={local.actions}>
                    <ActionButton label="编辑计划" tone="quiet" onPress={() => router.push(`/plans/${id}/edit` as never)} />
                    <ActionButton label={apply.isPending ? '启用中…' : '启用修改'} onPress={() => apply.mutate()} disabled={apply.isPending || !currentVersionNumber || summary.data.hasMissingConnection} />
                    {summary.data.allowedTransitions.map((status) => <ActionButton key={status} label={statusActionLabel(status)} tone={status === 'archived' ? 'danger' : 'quiet'} onPress={() => changeStatus.mutate(status)} disabled={changeStatus.isPending} />)}
                  </View>
                  {apply.isError || changeStatus.isError ? <Text style={local.error}>{planMutationErrorMessage(changeStatus.error ?? apply.error)}</Text> : null}
                </Surface>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HelpStep({ icon, text }: { icon: string; text: string }) {
  return <View style={local.helpStep}><View style={local.helpIcon}><Text style={local.helpIconText}>{icon}</Text></View><Text style={local.helpText}>{text}</Text></View>;
}

function planDetailIcon(kind?: string | null) {
  return ({ logistics: '📦', household: '🏠', content: '🎬', daily_summary: '✉️', study: '📚', device: '🖨️' } as Record<string, string>)[kind ?? ''] ?? '🛡️';
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
  safeArea: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.page, paddingTop: spacing.xl },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 72 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 64 },
  hero: { alignItems: 'center', paddingVertical: spacing.lg, marginBottom: spacing.xxl },
  heroIcon: { width: 68, height: 68, borderRadius: radius.lg, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  heroEmoji: { fontSize: 32 },
  eyebrow: { ...typography.label, color: colors.success, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xxxl, marginBottom: spacing.md },
  sectionTitleNoMargin: { ...typography.section, color: colors.text },
  helpSteps: { gap: spacing.lg },
  helpStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  helpIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
  helpIconText: { color: colors.success, fontWeight: '800' },
  helpText: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  sourceList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sourceChip: { backgroundColor: colors.accentSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  sourceText: { ...typography.bodyStrong, color: colors.primary },
  permissionText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg },
  resultDate: { ...typography.caption, color: colors.textMuted },
  resultTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.sm },
  inlineAction: { alignItems: 'flex-start', marginTop: spacing.lg },
  sectionGap: { marginTop: spacing.xxxl },
  settingsHeader: { marginTop: spacing.xxxl, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  chevron: { color: colors.primary, fontSize: 24 },
  settingsContent: { gap: spacing.md },
  cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  text: { ...typography.body, color: colors.textSecondary },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, backgroundColor: colors.background, marginTop: spacing.md, marginBottom: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
});
