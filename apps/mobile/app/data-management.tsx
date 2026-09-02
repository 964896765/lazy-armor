import { useQueries } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

export default function DataManagementPage() {
  const token = useAuthStore((state) => state.token);
  const results = useQueries({
    queries: [
      { queryKey: ['dm-connections', token], queryFn: () => api<unknown[]>('/connections', token), enabled: Boolean(token) },
      { queryKey: ['dm-device-profiles', token], queryFn: () => api<unknown[]>('/device-profiles', token), enabled: Boolean(token) },
      { queryKey: ['dm-vehicle-profiles', token], queryFn: () => api<unknown[]>('/vehicle-profiles', token), enabled: Boolean(token) },
      { queryKey: ['dm-digital-accounts', token], queryFn: () => api<unknown[]>('/digital-account-profiles', token), enabled: Boolean(token) },
      { queryKey: ['dm-recurring-items', token], queryFn: () => api<unknown[]>('/recurring-item-profiles', token), enabled: Boolean(token) },
      { queryKey: ['dm-plans', token], queryFn: () => api<unknown[]>('/plans', token), enabled: Boolean(token) },
      { queryKey: ['dm-executions', token], queryFn: () => api<unknown[]>('/executions', token), enabled: Boolean(token) },
    ],
  });
  const loading = results.some((item) => item.isLoading);
  const counts = results.map((item) => (item.data ?? []).length);

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="数据管理" subtitle="先告诉你现在有哪些连接、资料、计划和记录；账户删除流程如果还没进入生产开启，会明确标记 Deferred Gate。">
        {loading && <ActivityIndicator />}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>你当前的数据</Text>
          <Text style={styles.cardText}>连接：{counts[0] ?? 0}</Text>
          <Text style={styles.cardText}>设备资料：{(counts[1] ?? 0) + (counts[3] ?? 0) + (counts[4] ?? 0)}</Text>
          <Text style={styles.cardText}>车辆资料：{counts[2] ?? 0}</Text>
          <Text style={styles.cardText}>计划：{counts[5] ?? 0}</Text>
          <Text style={styles.cardText}>Execution / Record：{counts[6] ?? 0}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>删除规则说明</Text>
          <Text style={styles.cardText}>连接断开后会立即失去对应运行权限，但历史计划和记录仍保留事实轨迹。</Text>
          <Text style={styles.cardText}>Execution 与 Audit 保持追加式记录，不会为了界面删除而改写历史事实。</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>账户删除入口状态</Text>
          <Text style={styles.cardText}>当前状态：Deferred Gate</Text>
          <Text style={styles.cardText}>原因：P4 先建立正式入口与规则说明，真正生产删除流程留待后续安全验收完成后开启。</Text>
        </View>
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
});
