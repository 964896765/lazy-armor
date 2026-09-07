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

interface VehicleProfile {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileageKm: number;
  insuranceExpiresAt: string | null;
  inspectionDueAt: string | null;
  maintenanceDueAt: string | null;
  tireInstalledAt: string | null;
  batteryInstalledAt: string | null;
}

interface PlanUsage { planId: string; planName: string }

export default function VehiclesPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [mileageKm, setMileageKm] = useState('0');
  const vehicles = useQuery({
    queryKey: ['vehicle-profiles', token],
    queryFn: () => api<VehicleProfile[]>('/vehicle-profiles', token),
    enabled: Boolean(token),
  });
  const create = useMutation({
    mutationFn: () => api('/vehicle-profiles', token, {
      method: 'POST',
      body: JSON.stringify({ brand, model, year: Number(year), mileageKm: Number(mileageKm) }),
    }),
    onSuccess: async () => {
      setBrand('');
      setModel('');
      setAdding(false);
      await client.invalidateQueries({ queryKey: ['vehicle-profiles', token] });
    },
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor={colors.primary} refreshing={vehicles.isFetching && !vehicles.isLoading} onRefresh={vehicles.refetch} />}
      >
        <WorkspaceHeader
          title="我的车辆"
          subtitle="里程、保养、保险与关联提醒"
          onBack={() => router.back()}
          action={<Pressable accessibilityRole="button" accessibilityLabel="添加车辆" onPress={() => setAdding((value) => !value)} style={styles.headerAction}><Ionicons name={adding ? 'close' : 'add'} size={21} color={colors.primary} /></Pressable>}
        />

        {adding ? (
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>添加车辆</Text>
            <Text style={styles.sectionHint}>只保存你主动填写的车辆资料。</Text>
            <View style={styles.formGrid}>
              <Field value={brand} onChangeText={setBrand} placeholder="品牌" />
              <Field value={model} onChangeText={setModel} placeholder="车型" />
              <Field value={year} onChangeText={setYear} placeholder="年份" keyboardType="numeric" />
              <Field value={mileageKm} onChangeText={setMileageKm} placeholder="当前里程（km）" keyboardType="numeric" />
            </View>
            <PrimaryButton label={create.isPending ? '正在添加…' : '确认添加'} onPress={() => create.mutate()} disabled={create.isPending || !brand.trim() || !model.trim()} />
          </View>
        ) : null}

        {vehicles.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取车辆资料…</Text></View> : null}
        {vehicles.isError ? <InlineState title="车辆资料暂时不可用" action="重新加载" onPress={() => vehicles.refetch()} /> : null}
        {!vehicles.isLoading && !vehicles.isError && vehicles.data?.length === 0 ? <InlineState title="还没有车辆" detail="添加后可以统一查看保养、保险和里程提醒。" action="添加车辆" onPress={() => setAdding(true)} /> : null}

        {vehicles.data?.map((vehicle, index) => token ? <VehicleSection key={vehicle.id} item={vehicle} token={token} first={index === 0} /> : null)}
      </ScrollView>
    </SafeAreaView>
  );
}

function VehicleSection({ item, token, first }: { item: VehicleProfile; token: string; first: boolean }) {
  const client = useQueryClient();
  const [mileageKm, setMileageKm] = useState(String(item.mileageKm));
  const [editingMileage, setEditingMileage] = useState(false);
  const plans = useQuery({ queryKey: ['vehicle-plans', item.id], queryFn: () => api<PlanUsage[]>(`/vehicle-profiles/${item.id}/plans`, token) });
  const updateMileage = useMutation({
    mutationFn: () => api(`/vehicle-profiles/${item.id}/mileage`, token, { method: 'PATCH', body: JSON.stringify({ mileageKm: Number(mileageKm) }) }),
    onSuccess: async () => {
      setEditingMileage(false);
      await client.invalidateQueries({ queryKey: ['vehicle-profiles', token] });
    },
  });

  return (
    <View style={[styles.vehicleSection, !first && styles.sectionDivider]}>
      <View style={styles.vehicleHeading}>
        <View style={styles.vehicleIcon}><Ionicons name="car-sport-outline" size={23} color={colors.primary} /></View>
        <View style={styles.vehicleCopy}><Text style={styles.vehicleName}>{item.brand} {item.model}</Text><Text style={styles.muted}>{item.year} 款 · 正常管理</Text></View>
        <View style={styles.activePill}><Text style={styles.activeText}>使用中</Text></View>
      </View>

      <View style={styles.metrics}>
        <Metric value={item.mileageKm.toLocaleString('zh-CN')} label="当前里程 km" />
        <Metric value={daysUntil(item.maintenanceDueAt)} label="距保养" />
        <Metric value={daysUntil(item.insuranceExpiresAt)} label="距保险到期" />
      </View>

      <Text style={styles.sectionTitle}>待办提醒</Text>
      <InfoRow icon="construct-outline" label="车辆保养" value={dateLabel(item.maintenanceDueAt)} warning />
      <InfoRow icon="shield-checkmark-outline" label="保险到期" value={dateLabel(item.insuranceExpiresAt)} />
      <InfoRow icon="calendar-outline" label="车辆年检" value={dateLabel(item.inspectionDueAt)} />
      <InfoRow icon="disc-outline" label="轮胎安装" value={dateLabel(item.tireInstalledAt)} />
      <InfoRow icon="battery-charging-outline" label="电瓶安装" value={dateLabel(item.batteryInstalledAt)} last />

      <Pressable accessibilityRole="button" onPress={() => setEditingMileage((value) => !value)} style={styles.disclosure}>
        <View><Text style={styles.rowTitle}>更新车辆里程</Text><Text style={styles.rowSubtitle}>里程只允许向前更新，并保留操作记录。</Text></View>
        <Ionicons name={editingMileage ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
      </Pressable>
      {editingMileage ? (
        <View style={styles.inlineForm}>
          <Field value={mileageKm} onChangeText={setMileageKm} placeholder="新的里程数" keyboardType="numeric" />
          <PrimaryButton label={updateMileage.isPending ? '保存中…' : '保存里程'} onPress={() => updateMileage.mutate()} disabled={updateMileage.isPending || Number(mileageKm) < item.mileageKm} />
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>关联计划</Text>
      {plans.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {plans.data?.length ? plans.data.map((plan, index) => <InfoRow key={plan.planId} icon="calendar-outline" label={plan.planName} value="查看计划" last={index === plans.data.length - 1} />) : <Text style={styles.emptyLine}>当前还没有关联计划。</Text>}
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text numberOfLines={1} style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function InfoRow({ icon, label, value, warning = false, last = false }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string; warning?: boolean; last?: boolean }) {
  return <View style={[styles.infoRow, !last && styles.rowDivider]}><View style={[styles.infoIcon, warning && styles.infoIconWarning]}><Ionicons name={icon} size={17} color={warning ? colors.warning : colors.primary} /></View><Text style={styles.rowTitle}>{label}</Text><Text style={[styles.rowValue, warning && styles.rowValueWarning]}>{value}</Text></View>;
}

function Field(props: ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.textMuted} {...props} style={styles.input} />;
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function InlineState({ title, detail, action, onPress }: { title: string; detail?: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineStateCopy}><Text style={styles.rowTitle}>{title}</Text>{detail ? <Text style={styles.rowSubtitle}>{detail}</Text> : null}</View><Pressable accessibilityRole="button" onPress={onPress}><Text style={styles.textAction}>{action}</Text></Pressable></View>;
}

function dateLabel(value: string | null) {
  return value ? value.slice(0, 10) : '未设置';
}

function daysUntil(value: string | null) {
  if (!value) return '—';
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return '已到期';
  return `${days} 天`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accentSoft },
  formSection: { paddingVertical: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  formGrid: { gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  input: { ...typography.body, color: colors.text, minHeight: 44, paddingHorizontal: spacing.md, backgroundColor: colors.background, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  primaryButton: { minHeight: 42, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: 12, backgroundColor: colors.primary },
  primaryButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 64 },
  muted: { ...typography.caption, color: colors.textSecondary },
  vehicleSection: { paddingTop: spacing.xl, paddingBottom: spacing.lg },
  sectionDivider: { borderTopWidth: 8, borderTopColor: colors.background },
  vehicleHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  vehicleCopy: { flex: 1, minWidth: 0 },
  vehicleName: { ...typography.title, color: colors.text },
  activePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successSoft },
  activeText: { fontSize: 9, lineHeight: 12, fontWeight: '800', color: colors.success },
  metrics: { flexDirection: 'row', marginVertical: spacing.xl, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  metric: { flex: 1, minWidth: 0, paddingVertical: spacing.md, alignItems: 'center' },
  metricValue: { ...typography.section, color: colors.text },
  metricLabel: { fontSize: 9, lineHeight: 12, color: colors.textMuted, marginTop: 3, textAlign: 'center' },
  sectionTitle: { ...typography.section, color: colors.text, marginBottom: spacing.sm },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  infoRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  infoIconWarning: { backgroundColor: colors.warningSoft },
  rowTitle: { ...typography.bodyStrong, color: colors.text, flexShrink: 1 },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  rowValue: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto' },
  rowValueWarning: { color: colors.warning, fontWeight: '700' },
  disclosure: { marginTop: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  inlineForm: { gap: spacing.sm, paddingVertical: spacing.md },
  emptyLine: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.md },
  inlineState: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineStateCopy: { flex: 1 },
  textAction: { ...typography.bodyStrong, color: colors.primary },
});
