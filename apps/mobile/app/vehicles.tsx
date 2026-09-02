import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

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

interface PlanUsage {
  planId: string;
  planName: string;
}

function VehicleCard({ item, token }: { item: VehicleProfile; token: string }) {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ['vehicle-plans', item.id], queryFn: () => api<PlanUsage[]>(`/vehicle-profiles/${item.id}/plans`, token) });
  const [mileageKm, setMileageKm] = useState(String(item.mileageKm));
  const updateMileage = useMutation({
    mutationFn: () => api(`/vehicle-profiles/${item.id}/mileage`, token, {
      method: 'PATCH',
      body: JSON.stringify({ mileageKm: Number(mileageKm) }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['vehicle-profiles', token] }),
  });
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.brand} {item.model}</Text>
      <Text style={styles.cardText}>{item.year} 款 · 当前里程 {item.mileageKm} km</Text>
      <Text style={styles.cardText}>保险：{item.insuranceExpiresAt ? item.insuranceExpiresAt.slice(0, 10) : '未填写'}</Text>
      <Text style={styles.cardText}>年检：{item.inspectionDueAt ? item.inspectionDueAt.slice(0, 10) : '未填写'}</Text>
      <Text style={styles.cardText}>保养：{item.maintenanceDueAt ? item.maintenanceDueAt.slice(0, 10) : '未填写'}</Text>
      <Text style={styles.cardText}>轮胎：{item.tireInstalledAt ? item.tireInstalledAt.slice(0, 10) : '未填写'}</Text>
      <Text style={styles.cardText}>电瓶：{item.batteryInstalledAt ? item.batteryInstalledAt.slice(0, 10) : '未填写'}</Text>
      <Text style={local.subTitle}>人工更新里程</Text>
      <TextInput style={local.input} value={mileageKm} onChangeText={setMileageKm} keyboardType="numeric" placeholder="新的里程数" />
      <Button title={updateMileage.isPending ? '更新中…' : '保存里程'} onPress={() => updateMileage.mutate()} disabled={updateMileage.isPending} />
      <Text style={local.subTitle}>关联计划</Text>
      {plans.isLoading && <ActivityIndicator />}
      {plans.data?.length ? plans.data.map((plan) => <Text key={plan.planId} style={styles.cardText}>· {plan.planName}</Text>) : <Text style={styles.cardText}>当前还没有关联计划。</Text>}
    </View>
  );
}

export default function VehiclesPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const vehicles = useQuery({ queryKey: ['vehicle-profiles', token], queryFn: () => api<VehicleProfile[]>('/vehicle-profiles', token), enabled: Boolean(token) });
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2024');
  const [mileageKm, setMileageKm] = useState('0');
  const create = useMutation({
    mutationFn: () => api('/vehicle-profiles', token, {
      method: 'POST',
      body: JSON.stringify({ brand, model, year: Number(year), mileageKm: Number(mileageKm) }),
    }),
    onSuccess: () => {
      setBrand('');
      setModel('');
      void client.invalidateQueries({ queryKey: ['vehicle-profiles', token] });
    },
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="我的车辆" subtitle="车辆资料、里程和关联提醒统一管理；人工里程更新仍然遵守单调增加和审计记录。">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>新增车辆</Text>
          <TextInput style={local.input} value={brand} onChangeText={setBrand} placeholder="品牌" />
          <TextInput style={local.input} value={model} onChangeText={setModel} placeholder="车型" />
          <TextInput style={local.input} value={year} onChangeText={setYear} placeholder="年份" keyboardType="numeric" />
          <TextInput style={local.input} value={mileageKm} onChangeText={setMileageKm} placeholder="当前里程" keyboardType="numeric" />
          <Button title={create.isPending ? '创建中…' : '新增车辆'} onPress={() => create.mutate()} disabled={create.isPending || !brand.trim() || !model.trim()} />
        </View>
        {vehicles.isLoading && <ActivityIndicator />}
        {vehicles.data?.map((item) => token ? <VehicleCard key={item.id} item={item} token={token} /> : null)}
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#FAFBFA' },
  subTitle: { color: '#24342C', fontWeight: '700', marginTop: 16, marginBottom: 8 },
});
