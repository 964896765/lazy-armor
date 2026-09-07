import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { colors, spacing, typography, WorkspaceHeader } from '../src/design';

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

interface PlanUsage { planId: string; planName: string }

export default function DevicesPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('净水器');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(new Date().toISOString().slice(0, 10));
  const profiles = useQuery({ queryKey: ['device-profiles', token], queryFn: () => api<DeviceProfile[]>('/device-profiles', token), enabled: Boolean(token) });
  const create = useMutation({
    mutationFn: () => api('/device-profiles', token, {
      method: 'POST',
      body: JSON.stringify({ type, brand, model, purchasedAt: normalizeDate(purchasedAt), sourceType: 'manual' }),
    }),
    onSuccess: async () => {
      setBrand('');
      setModel('');
      setAdding(false);
      await client.invalidateQueries({ queryKey: ['device-profiles', token] });
    },
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor={colors.primary} refreshing={profiles.isFetching && !profiles.isLoading} onRefresh={profiles.refetch} />}
      >
        <WorkspaceHeader
          title="我的设备"
          subtitle="设备、耗材与维护提醒"
          onBack={() => router.back()}
          action={<Pressable accessibilityRole="button" accessibilityLabel="添加设备" onPress={() => setAdding((value) => !value)} style={styles.headerAction}><Ionicons name={adding ? 'close' : 'add'} size={21} color={colors.primary} /></Pressable>}
        />

        {adding ? (
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>添加设备</Text>
            <Text style={styles.sectionHint}>填写基础资料后，再为它设置耗材和维护周期。</Text>
            <View style={styles.formFields}>
              <Field value={type} onChangeText={setType} placeholder="设备类型" />
              <Field value={brand} onChangeText={setBrand} placeholder="品牌" />
              <Field value={model} onChangeText={setModel} placeholder="型号" />
              <Field value={purchasedAt} onChangeText={setPurchasedAt} placeholder="购买日期 YYYY-MM-DD" />
            </View>
            <PrimaryButton label={create.isPending ? '正在添加…' : '确认添加'} onPress={() => create.mutate()} disabled={create.isPending || !brand.trim() || !model.trim()} />
          </View>
        ) : null}

        {profiles.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取设备资料…</Text></View> : null}
        {profiles.isError ? <InlineState title="设备资料暂时不可用" action="重新加载" onPress={() => profiles.refetch()} /> : null}
        {!profiles.isLoading && !profiles.isError && profiles.data?.length === 0 ? <InlineState title="还没有设备" detail="添加后可以跟踪维护周期和耗材更换。" action="添加设备" onPress={() => setAdding(true)} /> : null}
        {profiles.data?.map((item, index) => token ? <DeviceSection key={item.id} item={item} token={token} first={index === 0} /> : null)}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeviceSection({ item, token, first }: { item: DeviceProfile; token: string; first: boolean }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingConsumable, setAddingConsumable] = useState(false);
  const [brand, setBrand] = useState(item.brand);
  const [model, setModel] = useState(item.model);
  const [maintenanceDays, setMaintenanceDays] = useState(item.maintenanceIntervalDays ? String(item.maintenanceIntervalDays) : '');
  const [consumableName, setConsumableName] = useState('');
  const [lastReplacedAt, setLastReplacedAt] = useState(new Date().toISOString().slice(0, 10));
  const [replacementDays, setReplacementDays] = useState('180');
  const [remindDays, setRemindDays] = useState('14');
  const consumables = useQuery({ queryKey: ['device-consumables', item.id], queryFn: () => api<DeviceConsumable[]>(`/device-consumables?deviceProfileId=${item.id}`, token) });
  const plans = useQuery({ queryKey: ['device-plans', item.id], queryFn: () => api<PlanUsage[]>(`/device-profiles/${item.id}/plans`, token) });
  const update = useMutation({
    mutationFn: () => api(`/device-profiles/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ brand, model, maintenanceIntervalDays: maintenanceDays ? Number(maintenanceDays) : undefined }) }),
    onSuccess: async () => {
      setEditing(false);
      await client.invalidateQueries({ queryKey: ['device-profiles'] });
    },
  });
  const createConsumable = useMutation({
    mutationFn: () => api('/device-consumables', token, {
      method: 'POST',
      body: JSON.stringify({ deviceProfileId: item.id, name: consumableName, lastReplacedAt: normalizeDate(lastReplacedAt), replacementIntervalDays: Number(replacementDays), remindBeforeDays: Number(remindDays) }),
    }),
    onSuccess: async () => {
      setConsumableName('');
      setAddingConsumable(false);
      await client.invalidateQueries({ queryKey: ['device-consumables', item.id] });
    },
  });
  const replaceConsumable = useMutation({
    mutationFn: (consumable: DeviceConsumable) => api(`/device-consumables/${consumable.id}/replacement`, token, { method: 'PATCH', body: JSON.stringify({ lastReplacedAt: new Date().toISOString() }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['device-consumables', item.id] }),
  });

  return (
    <View style={[styles.deviceSection, !first && styles.sectionDivider]}>
      <View style={styles.deviceHeading}>
        <View style={styles.deviceIcon}><Ionicons name="hardware-chip-outline" size={22} color={colors.primary} /></View>
        <View style={styles.headingCopy}><Text style={styles.deviceName}>{item.brand} {item.model}</Text><Text style={styles.muted}>{item.type} · 购买于 {item.purchasedAt.slice(0, 10)}</Text></View>
        <View style={styles.activePill}><Text style={styles.activeText}>正常使用</Text></View>
      </View>

      <View style={styles.metrics}>
        <Metric value={daysUntil(item.warrantyUntil)} label="距保修到期" />
        <Metric value={item.maintenanceIntervalDays ? `${item.maintenanceIntervalDays} 天` : '—'} label="维护周期" />
        <Metric value={String(consumables.data?.length ?? 0)} label="跟踪耗材" />
      </View>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>耗材与维护</Text><Pressable accessibilityRole="button" onPress={() => setAddingConsumable((value) => !value)}><Text style={styles.textAction}>{addingConsumable ? '取消' : '＋ 添加耗材'}</Text></Pressable></View>
      {consumables.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {consumables.data?.map((consumable, index) => (
        <View key={consumable.id} style={[styles.infoRow, index < consumables.data.length - 1 && styles.rowDivider]}>
          <View style={styles.infoIcon}><Ionicons name="refresh-outline" size={17} color={colors.primary} /></View>
          <View style={styles.infoCopy}><Text style={styles.rowTitle}>{consumable.name}</Text><Text style={styles.rowSubtitle}>预计更换 {consumable.expectedReplaceAt.slice(0, 10)} · 提前 {consumable.remindBeforeDays} 天提醒</Text></View>
          <Pressable accessibilityRole="button" onPress={() => replaceConsumable.mutate(consumable)} disabled={replaceConsumable.isPending}><Text style={styles.textAction}>已更换</Text></Pressable>
        </View>
      ))}
      {!consumables.isLoading && consumables.data?.length === 0 ? <Text style={styles.emptyLine}>还没有跟踪耗材。</Text> : null}

      {addingConsumable ? (
        <View style={styles.inlineForm}>
          <Field value={consumableName} onChangeText={setConsumableName} placeholder="耗材名称" />
          <Field value={lastReplacedAt} onChangeText={setLastReplacedAt} placeholder="最近更换日期 YYYY-MM-DD" />
          <View style={styles.twoColumns}><View style={styles.column}><Field value={replacementDays} onChangeText={setReplacementDays} placeholder="周期（天）" keyboardType="numeric" /></View><View style={styles.column}><Field value={remindDays} onChangeText={setRemindDays} placeholder="提前提醒" keyboardType="numeric" /></View></View>
          <PrimaryButton label={createConsumable.isPending ? '添加中…' : '确认添加'} onPress={() => createConsumable.mutate()} disabled={createConsumable.isPending || !consumableName.trim()} />
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => setEditing((value) => !value)} style={styles.disclosure}>
        <View><Text style={styles.rowTitle}>设备资料</Text><Text style={styles.rowSubtitle}>修改品牌、型号与维护周期。</Text></View><Ionicons name={editing ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
      </Pressable>
      {editing ? <View style={styles.inlineForm}><Field value={brand} onChangeText={setBrand} placeholder="品牌" /><Field value={model} onChangeText={setModel} placeholder="型号" /><Field value={maintenanceDays} onChangeText={setMaintenanceDays} placeholder="维护周期（天）" keyboardType="numeric" /><PrimaryButton label={update.isPending ? '保存中…' : '保存资料'} onPress={() => update.mutate()} disabled={update.isPending} /></View> : null}

      <Text style={styles.sectionTitle}>关联计划</Text>
      {plans.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {plans.data?.length ? plans.data.map((plan, index) => <InfoRow key={plan.planId} label={plan.planName} last={index === plans.data.length - 1} />) : <Text style={styles.emptyLine}>当前还没有关联计划。</Text>}
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text numberOfLines={1} style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function InfoRow({ label, last }: { label: string; last: boolean }) { return <View style={[styles.infoRow, !last && styles.rowDivider]}><View style={styles.infoIcon}><Ionicons name="calendar-outline" size={17} color={colors.primary} /></View><Text style={styles.rowTitle}>{label}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></View>; }
function Field(props: ComponentProps<typeof TextInput>) { return <TextInput placeholderTextColor={colors.textMuted} {...props} style={styles.input} />; }
function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>; }
function InlineState({ title, detail, action, onPress }: { title: string; detail?: string; action: string; onPress: () => void }) { return <View style={styles.inlineState}><View style={styles.inlineStateCopy}><Text style={styles.rowTitle}>{title}</Text>{detail ? <Text style={styles.rowSubtitle}>{detail}</Text> : null}</View><Pressable accessibilityRole="button" onPress={onPress}><Text style={styles.textAction}>{action}</Text></Pressable></View>; }
function normalizeDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00.000Z` : value.trim(); }
function daysUntil(value: string | null) { if (!value) return '—'; const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000); return days < 0 ? '已到期' : `${days} 天`; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1, backgroundColor: colors.surface }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accentSoft },
  formSection: { paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border }, formFields: { gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  input: { ...typography.body, color: colors.text, minHeight: 44, paddingHorizontal: spacing.md, backgroundColor: colors.background, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  primaryButton: { minHeight: 42, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: 12, backgroundColor: colors.primary }, primaryButtonText: { ...typography.bodyStrong, color: '#FFFFFF' }, disabled: { opacity: 0.45 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 64 }, muted: { ...typography.caption, color: colors.textSecondary },
  inlineState: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, inlineStateCopy: { flex: 1 },
  deviceSection: { paddingTop: spacing.xl, paddingBottom: spacing.lg }, sectionDivider: { borderTopWidth: 8, borderTopColor: colors.background },
  deviceHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, deviceIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, headingCopy: { flex: 1, minWidth: 0 }, deviceName: { ...typography.title, color: colors.text },
  activePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successSoft }, activeText: { fontSize: 9, lineHeight: 12, fontWeight: '800', color: colors.success },
  metrics: { flexDirection: 'row', marginVertical: spacing.xl, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }, metric: { flex: 1, minWidth: 0, paddingVertical: spacing.md, alignItems: 'center' }, metricValue: { ...typography.section, color: colors.text }, metricLabel: { fontSize: 9, lineHeight: 12, color: colors.textMuted, marginTop: 3, textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { ...typography.section, color: colors.text, marginBottom: spacing.sm }, sectionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  infoRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }, rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border }, infoIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft }, infoCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.bodyStrong, color: colors.text, flexShrink: 1 }, rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 }, textAction: { ...typography.bodyStrong, color: colors.primary },
  emptyLine: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.md }, inlineForm: { gap: spacing.sm, paddingVertical: spacing.md }, twoColumns: { flexDirection: 'row', gap: spacing.sm }, column: { flex: 1 },
  disclosure: { marginTop: spacing.lg, marginBottom: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
});
