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
  const failed = results.some((item) => item.isError);
  const counts = results.map((item) => (item.data ?? []).length);

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="数据管理" subtitle="先告诉你现在有哪些连接、资料、计划和记录；账户删除流程尚未正式开启。">
        {loading && <ActivityIndicator />}
        {!token ? <View style={styles.card}><Text style={styles.cardTitle}>登录后查看</Text><Text style={styles.cardText}>这里只会读取属于你账号的数据，不会显示示例数量。</Text></View> : null}
        {failed ? <View style={styles.card}><Text style={styles.cardTitle}>数据暂时无法完整读取</Text><Text style={styles.cardText}>下方不会把加载失败的项目显示成 0。请恢复连接后重试。</Text></View> : null}
        {token && !loading && !failed ? <View style={styles.card}>
          <Text style={styles.cardTitle}>你当前的数据</Text>
          <Text style={styles.cardText}>连接：{counts[0] ?? 0}</Text>
          <Text style={styles.cardText}>设备资料：{(counts[1] ?? 0) + (counts[3] ?? 0) + (counts[4] ?? 0)}</Text>
          <Text style={styles.cardText}>车辆资料：{counts[2] ?? 0}</Text>
          <Text style={styles.cardText}>计划：{counts[5] ?? 0}</Text>
          <Text style={styles.cardText}>运行记录：{counts[6] ?? 0}</Text>
        </View> : null}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>删除规则说明</Text>
          <Text style={styles.cardText}>连接断开后会立即失去对应运行权限，但历史计划和记录仍保留事实轨迹。</Text>
          <Text style={styles.cardText}>运行与安全记录保持追加式记录，不会为了界面删除而改写历史事实。</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>账户删除入口状态</Text>
          <Text style={styles.cardText}>当前状态：尚未开启</Text>
          <Text style={styles.cardText}>账户删除流程尚未完成安全验收，正式入口会后续开启。</Text>
        </View>
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
});
