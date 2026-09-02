import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

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

interface PlanUsage {
  planId: string;
  planName: string;
}

function DeviceCard({ item, token }: { item: DeviceProfile; token: string }) {
  const client = useQueryClient();
  const consumables = useQuery({ queryKey: ['device-consumables', item.id], queryFn: () => api<DeviceConsumable[]>(`/device-consumables?deviceProfileId=${item.id}`, token) });
  const plans = useQuery({ queryKey: ['device-plans', item.id], queryFn: () => api<PlanUsage[]>(`/device-profiles/${item.id}/plans`, token) });
  const [brand, setBrand] = useState(item.brand);
  const [model, setModel] = useState(item.model);
  const [maintenanceIntervalDays, setMaintenanceIntervalDays] = useState(item.maintenanceIntervalDays ? String(item.maintenanceIntervalDays) : '');
  const [consumableName, setConsumableName] = useState('');
  const [lastReplacedAt, setLastReplacedAt] = useState('2027-01-01T00:00:00.000Z');
  const [replacementIntervalDays, setReplacementIntervalDays] = useState('180');
  const [remindBeforeDays, setRemindBeforeDays] = useState('14');
  const update = useMutation({
    mutationFn: () => api(`/device-profiles/${item.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        brand,
        model,
        maintenanceIntervalDays: maintenanceIntervalDays ? Number(maintenanceIntervalDays) : undefined,
      }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['device-profiles'] }),
  });
  const createConsumable = useMutation({
    mutationFn: () => api('/device-consumables', token, {
      method: 'POST',
      body: JSON.stringify({
        deviceProfileId: item.id,
        name: consumableName,
        lastReplacedAt,
        replacementIntervalDays: Number(replacementIntervalDays),
        remindBeforeDays: Number(remindBeforeDays),
      }),
    }),
    onSuccess: () => {
      setConsumableName('');
      void client.invalidateQueries({ queryKey: ['device-consumables', item.id] });
    },
  });
  const refreshConsumable = useMutation({
    mutationFn: (consumable: DeviceConsumable) => api(`/device-consumables/${consumable.id}/replacement`, token, {
      method: 'PATCH',
      body: JSON.stringify({ lastReplacedAt: new Date().toISOString() }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['device-consumables', item.id] }),
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.brand} {item.model}</Text>
      <Text style={styles.cardText}>{item.type} · 购买于 {item.purchasedAt.slice(0, 10)}</Text>
      <Text style={styles.cardText}>保修到期：{item.warrantyUntil ? item.warrantyUntil.slice(0, 10) : '未填写'}</Text>
      <Text style={styles.cardText}>维护周期：{item.maintenanceIntervalDays ? `${item.maintenanceIntervalDays} 天` : '未填写'}</Text>

      <Text style={local.subTitle}>修改设备资料</Text>
      <TextInput style={local.input} value={brand} onChangeText={setBrand} placeholder="品牌" />
      <TextInput style={local.input} value={model} onChangeText={setModel} placeholder="型号" />
      <TextInput style={local.input} value={maintenanceIntervalDays} onChangeText={setMaintenanceIntervalDays} placeholder="维护周期（天）" keyboardType="numeric" />
      <Button title={update.isPending ? '保存中…' : '保存资料'} onPress={() => update.mutate()} disabled={update.isPending} />

      <Text style={local.subTitle}>耗材</Text>
      {consumables.isLoading && <ActivityIndicator />}
      {consumables.data?.map((consumable) => (
        <View key={consumable.id} style={local.inlineCard}>
          <Text style={styles.cardText}>{consumable.name}</Text>
          <Text style={styles.cardText}>最近更换：{consumable.lastReplacedAt.slice(0, 10)}</Text>
          <Text style={styles.cardText}>下次预计更换：{consumable.expectedReplaceAt.slice(0, 10)}</Text>
          <Button title="刚刚已更换" onPress={() => refreshConsumable.mutate(consumable)} disabled={refreshConsumable.isPending} />
        </View>
      ))}
      <TextInput style={local.input} value={consumableName} onChangeText={setConsumableName} placeholder="新增耗材名称" />
      <TextInput style={local.input} value={lastReplacedAt} onChangeText={setLastReplacedAt} placeholder="最近更换时间 ISO" />
      <TextInput style={local.input} value={replacementIntervalDays} onChangeText={setReplacementIntervalDays} placeholder="更换周期（天）" keyboardType="numeric" />
      <TextInput style={local.input} value={remindBeforeDays} onChangeText={setRemindBeforeDays} placeholder="提前提醒（天）" keyboardType="numeric" />
      <Button title={createConsumable.isPending ? '添加中…' : '添加耗材'} onPress={() => createConsumable.mutate()} disabled={createConsumable.isPending || !consumableName.trim()} />

      <Text style={local.subTitle}>关联计划</Text>
      {plans.isLoading && <ActivityIndicator />}
      {plans.data?.length ? plans.data.map((plan) => <Text key={plan.planId} style={styles.cardText}>· {plan.planName}</Text>) : <Text style={styles.cardText}>当前还没有关联计划。</Text>}
    </View>
  );
}

export default function DevicesPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const profiles = useQuery({ queryKey: ['device-profiles', token], queryFn: () => api<DeviceProfile[]>('/device-profiles', token), enabled: Boolean(token) });
  const [type, setType] = useState('净水器');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [purchasedAt, setPurchasedAt] = useState('2026-12-01T00:00:00.000Z');
  const create = useMutation({
    mutationFn: () => api('/device-profiles', token, {
      method: 'POST',
      body: JSON.stringify({ type, brand, model, purchasedAt, sourceType: 'manual' }),
    }),
    onSuccess: () => {
      setBrand('');
      setModel('');
      void client.invalidateQueries({ queryKey: ['device-profiles', token] });
    },
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="我的设备" subtitle="设备资料、耗材和关联计划都放在这里管理，计划本身仍然走统一的 Plan Engine。">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>新增设备</Text>
          <TextInput style={local.input} value={type} onChangeText={setType} placeholder="设备类型" />
          <TextInput style={local.input} value={brand} onChangeText={setBrand} placeholder="品牌" />
          <TextInput style={local.input} value={model} onChangeText={setModel} placeholder="型号" />
          <TextInput style={local.input} value={purchasedAt} onChangeText={setPurchasedAt} placeholder="购买时间 ISO" />
          <Button title={create.isPending ? '创建中…' : '新增设备'} onPress={() => create.mutate()} disabled={create.isPending || !brand.trim() || !model.trim()} />
        </View>
        {profiles.isLoading && <ActivityIndicator />}
        {profiles.data?.map((item) => token ? <DeviceCard key={item.id} item={item} token={token} /> : null)}
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#FAFBFA' },
  subTitle: { color: '#24342C', fontWeight: '700', marginTop: 16, marginBottom: 8 },
  inlineCard: { borderTopWidth: 1, borderTopColor: '#EDF0EE', marginTop: 10, paddingTop: 10 },
});
