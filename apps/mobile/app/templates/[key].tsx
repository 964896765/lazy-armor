import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { automationLevelLabel } from '../../src/plan-presenter';
import {
  buildInitialTemplateConfig,
  normalizeTemplateConfig,
  TemplateConfigForm,
  type TemplateConfigField,
  type TemplateConfigValues,
} from '../../src/template-config-form';

interface TemplateDetail {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  templateVersion: string;
  status: string;
  automationLevel: string;
  requiredConnectors: string[];
  details: {
    doesWhat: string;
    runsWhen: string;
    dataNeeded: string;
    remindsWhen: string;
    connectionSummary: string;
    riskSummary: string;
  };
  configFields: TemplateConfigField[];
  defaultConfig: Record<string, unknown>;
}

interface DeviceProfile {
  id: string;
  type: string;
  brand: string;
  model: string;
  purchasedAt: string;
  warrantyUntil: string | null;
  maintenanceIntervalDays: number | null;
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

export default function TemplateDetailPage() {
  const { key, draft } = useLocalSearchParams<{ key: string; draft?: string }>();
  const isDeviceTemplate = key === 'device-consumable-reminder';
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['template-detail', key, token],
    queryFn: () => api<TemplateDetail>(`/templates/${key}`, token),
    enabled: Boolean(key && token),
  });
  const draftConfig = useMemo(() => {
    if (!draft) return undefined;
    try {
      return JSON.parse(draft) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, [draft]);
  const initialValues = useMemo(
    () => buildInitialTemplateConfig(detail.data?.configFields ?? [], detail.data?.defaultConfig, draftConfig),
    [detail.data, draftConfig],
  );
  const [values, setValues] = useState<TemplateConfigValues>({});
  const [deviceDraft, setDeviceDraft] = useState({
    type: '净水器',
    brand: '',
    model: '',
    purchasedAt: '',
    warrantyUntil: '',
    maintenanceIntervalDays: '180',
  });
  const [consumableDraft, setConsumableDraft] = useState({
    name: '',
    lastReplacedAt: '',
    replacementIntervalDays: '150',
    remindBeforeDays: '10',
  });

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const selectedDeviceProfileId = typeof values.deviceProfileId === 'string' ? values.deviceProfileId : '';
  const selectedConsumableId = typeof values.consumableId === 'string' ? values.consumableId : '';
  const visibleFields = useMemo(
    () => (detail.data?.configFields ?? []).filter((field) => !isDeviceTemplate || !['deviceProfileId', 'consumableId'].includes(field.key)),
    [detail.data, isDeviceTemplate],
  );
  const deviceProfiles = useQuery({
    queryKey: ['device-profiles', token],
    queryFn: () => api<DeviceProfile[]>('/device-profiles', token),
    enabled: Boolean(token && isDeviceTemplate),
  });
  const deviceConsumables = useQuery({
    queryKey: ['device-consumables', token, selectedDeviceProfileId],
    queryFn: () => api<DeviceConsumable[]>(
      selectedDeviceProfileId
        ? `/device-consumables?deviceProfileId=${encodeURIComponent(selectedDeviceProfileId)}`
        : '/device-consumables',
      token,
    ),
    enabled: Boolean(token && isDeviceTemplate),
  });
  const createProfile = useMutation({
    mutationFn: () => api<DeviceProfile>('/device-profiles', token, {
      method: 'POST',
      body: JSON.stringify({
        type: deviceDraft.type.trim(),
        brand: deviceDraft.brand.trim(),
        model: deviceDraft.model.trim(),
        purchasedAt: normalizeDateInput(deviceDraft.purchasedAt),
        warrantyUntil: deviceDraft.warrantyUntil.trim() ? normalizeDateInput(deviceDraft.warrantyUntil) : undefined,
        maintenanceIntervalDays: Number(deviceDraft.maintenanceIntervalDays),
        sourceType: 'manual',
      }),
    }),
    onSuccess: async (profile) => {
      setValues((current) => ({ ...current, deviceProfileId: profile.id, consumableId: '' }));
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device-profiles', token] }),
        client.invalidateQueries({ queryKey: ['device-consumables', token] }),
      ]);
    },
  });
  const createConsumable = useMutation({
    mutationFn: () => {
      if (!selectedDeviceProfileId) throw new Error('请先选择设备');
      return api<DeviceConsumable>('/device-consumables', token, {
        method: 'POST',
        body: JSON.stringify({
          deviceProfileId: selectedDeviceProfileId,
          name: consumableDraft.name.trim(),
          lastReplacedAt: normalizeDateInput(consumableDraft.lastReplacedAt),
          replacementIntervalDays: Number(consumableDraft.replacementIntervalDays),
          remindBeforeDays: Number(consumableDraft.remindBeforeDays),
        }),
      });
    },
    onSuccess: async (consumable) => {
      setValues((current) => ({ ...current, consumableId: consumable.id }));
      await client.invalidateQueries({ queryKey: ['device-consumables', token, selectedDeviceProfileId] });
    },
  });
  const selectedProfile = deviceProfiles.data?.find((item) => item.id === selectedDeviceProfileId) ?? null;
  const selectedConsumable = deviceConsumables.data?.find((item) => item.id === selectedConsumableId) ?? null;

  const install = useMutation({
    mutationFn: () => api<{ id: string }>(`/templates/${key}/install`, token, {
      method: 'POST',
      body: JSON.stringify({ config: normalizeTemplateConfig(detail.data?.configFields ?? [], values) }),
    }),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['templates', token] }),
      ]);
      router.replace(`/plans/${result.id}` as never);
    },
  });

  if (!token) {
    return (
      <ScrollView style={local.page} contentContainerStyle={local.content}>
        <View style={local.card}>
          <Text style={local.title}>请先登录</Text>
          <Text style={local.text}>登录后才能查看模板详情并装上计划。</Text>
          <Button title="去登录" onPress={() => router.push('/connections')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={detail.isFetching} onRefresh={() => detail.refetch()} />}
    >
      {detail.isLoading && <ActivityIndicator />}
      {detail.isError && (
        <View style={local.card}>
          <Text style={local.title}>模板详情加载失败</Text>
          <Button title="重新加载" onPress={() => detail.refetch()} />
        </View>
      )}
      {detail.data && (
        <>
          <Text style={local.eyebrow}>懒人计划库</Text>
          <Text style={local.title}>{detail.data.icon} · {detail.data.name}</Text>
          <Text style={local.subtitle}>{detail.data.description}</Text>

          <View style={local.card}>
            <Text style={local.cardTitle}>模板信息</Text>
            <Text style={local.text}>分类：{detail.data.group}</Text>
            <Text style={local.text}>它会怎么帮你：{automationLevelLabel(detail.data.automationLevel)}</Text>
            <Text style={local.text}>模板版本：V{detail.data.templateVersion}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>它会替你做什么</Text>
            <Text style={local.text}>{detail.data.details.doesWhat}</Text>
            <Text style={local.cardTitle}>什么时候运行</Text>
            <Text style={local.text}>{detail.data.details.runsWhen}</Text>
            <Text style={local.cardTitle}>需要什么数据</Text>
            <Text style={local.text}>{detail.data.details.dataNeeded}</Text>
            <Text style={local.cardTitle}>什么时候会提醒</Text>
            <Text style={local.text}>{detail.data.details.remindsWhen}</Text>
            <Text style={local.cardTitle}>需要哪些连接</Text>
            <Text style={local.text}>{detail.data.details.connectionSummary}</Text>
            <Text style={local.cardTitle}>风险与确认</Text>
            <Text style={local.text}>{detail.data.details.riskSummary}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>安装前配置</Text>
            {isDeviceTemplate ? (
              <Text style={local.text}>先手工建设备与耗材，再把它装进提醒计划里。这里不会接真实设备 API，也不会自动下单。</Text>
            ) : null}
            <TemplateConfigForm
              fields={visibleFields}
              values={values}
              onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
            />
          </View>

          {isDeviceTemplate ? (
            <>
              <View style={local.card}>
                <Text style={local.cardTitle}>1. 创建或选择设备</Text>
                <Text style={local.text}>先把你的设备录进去，例如净水器、扫地机或空调。后续同一台设备可以复用。</Text>
                <TextInput
                  style={local.input}
                  placeholder="设备类型，例如：净水器"
                  value={deviceDraft.type}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, type: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="品牌，例如：小米"
                  value={deviceDraft.brand}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, brand: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="型号，例如：净水器 Pro"
                  value={deviceDraft.model}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, model: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="购买日期，YYYY-MM-DD"
                  value={deviceDraft.purchasedAt}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, purchasedAt: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="保修到期，YYYY-MM-DD，可选"
                  value={deviceDraft.warrantyUntil}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, warrantyUntil: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="维护周期（天），可选"
                  keyboardType="numeric"
                  value={deviceDraft.maintenanceIntervalDays}
                  onChangeText={(text) => setDeviceDraft((current) => ({ ...current, maintenanceIntervalDays: text }))}
                />
                <Button title={createProfile.isPending ? '保存设备中…' : '保存设备'} onPress={() => createProfile.mutate()} disabled={createProfile.isPending} />
                {createProfile.isError ? <Text style={local.error}>设备保存失败，请检查日期和必填项。</Text> : null}
                {deviceProfiles.data?.length ? (
                  <View style={local.optionWrap}>
                    {deviceProfiles.data.map((profile) => {
                      const active = profile.id === selectedDeviceProfileId;
                      return (
                        <Pressable
                          key={profile.id}
                          style={[local.pickCard, active ? local.pickCardActive : null]}
                          onPress={() => setValues((current) => ({ ...current, deviceProfileId: profile.id, consumableId: '' }))}
                        >
                          <Text style={[local.pickTitle, active ? local.pickTitleActive : null]}>{profile.brand} {profile.model}</Text>
                          <Text style={local.pickText}>{profile.type} · 购入于 {formatShortDate(profile.purchasedAt)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>

              <View style={local.card}>
                <Text style={local.cardTitle}>2. 设置耗材</Text>
                <Text style={local.text}>选中设备后，录入需要跟踪的耗材和更换周期。系统只会提醒你或准备购买清单，不会自动购买。</Text>
                {selectedProfile ? <Text style={local.selection}>当前设备：{selectedProfile.brand} {selectedProfile.model}</Text> : <Text style={local.text}>请先在上一步选择一台设备。</Text>}
                <TextInput
                  style={local.input}
                  placeholder="耗材名称，例如：前置滤芯"
                  value={consumableDraft.name}
                  onChangeText={(text) => setConsumableDraft((current) => ({ ...current, name: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="上次更换时间，YYYY-MM-DD"
                  value={consumableDraft.lastReplacedAt}
                  onChangeText={(text) => setConsumableDraft((current) => ({ ...current, lastReplacedAt: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="更换周期（天）"
                  keyboardType="numeric"
                  value={consumableDraft.replacementIntervalDays}
                  onChangeText={(text) => setConsumableDraft((current) => ({ ...current, replacementIntervalDays: text }))}
                />
                <TextInput
                  style={local.input}
                  placeholder="提前提醒（天）"
                  keyboardType="numeric"
                  value={consumableDraft.remindBeforeDays}
                  onChangeText={(text) => setConsumableDraft((current) => ({ ...current, remindBeforeDays: text }))}
                />
                <Button title={createConsumable.isPending ? '保存耗材中…' : '保存耗材'} onPress={() => createConsumable.mutate()} disabled={createConsumable.isPending || !selectedDeviceProfileId} />
                {createConsumable.isError ? <Text style={local.error}>耗材保存失败，请先选设备并检查日期。</Text> : null}
                {deviceConsumables.data?.length ? (
                  <View style={local.optionWrap}>
                    {deviceConsumables.data.map((consumable) => {
                      const active = consumable.id === selectedConsumableId;
                      return (
                        <Pressable
                          key={consumable.id}
                          style={[local.pickCard, active ? local.pickCardActive : null]}
                          onPress={() => setValues((current) => ({ ...current, consumableId: consumable.id }))}
                        >
                          <Text style={[local.pickTitle, active ? local.pickTitleActive : null]}>{consumable.name}</Text>
                          <Text style={local.pickText}>预计更换：{formatShortDate(consumable.expectedReplaceAt)} · 周期 {consumable.replacementIntervalDays} 天</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {selectedConsumable ? <Text style={local.selection}>当前耗材：{selectedConsumable.name} · 预计 {formatShortDate(selectedConsumable.expectedReplaceAt)} 更换</Text> : null}
              </View>
            </>
          ) : null}

          <View style={local.card}>
            <Text style={local.text}>装上后会生成一个正式 Plan Draft，之后还能继续修改阈值、周期和提醒方式。</Text>
            <Button
              title={install.isPending ? '装上中…' : '装上'}
              onPress={() => install.mutate()}
              disabled={install.isPending || (isDeviceTemplate && (!selectedDeviceProfileId || !selectedConsumableId))}
            />
            {isDeviceTemplate && (!selectedDeviceProfileId || !selectedConsumableId) ? (
              <Text style={local.text}>先选好设备和耗材，才能装上这条提醒计划。</Text>
            ) : null}
            {install.isError ? <Text style={local.error}>装上失败，请检查配置后重试。</Text> : null}
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

function formatShortDate(value: string | null | undefined) {
  if (!value) return '未设置';
  return value.slice(0, 10);
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
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#FAFBFA', marginTop: 10 },
  optionWrap: { gap: 8, marginTop: 12 },
  pickCard: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 14, padding: 12, backgroundColor: '#FAFBFA' },
  pickCardActive: { borderColor: '#287052', backgroundColor: '#EAF5EF' },
  pickTitle: { color: '#24342C', fontWeight: '700' },
  pickTitleActive: { color: '#287052' },
  pickText: { color: '#6B7770', marginTop: 4, lineHeight: 18 },
  selection: { color: '#287052', marginTop: 10, fontWeight: '600' },
  error: { color: '#A63D3D', marginTop: 10 },
});
