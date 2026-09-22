import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/auth-store';
import { heartbeatDevice, listDeviceTasks } from '../../src/device-task-client';
import { ActionButton, Surface, colors, spacing, typography } from '../../src/design';

export default function DeviceTasksPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const tasks = useQuery({ queryKey: ['device-tasks', token], queryFn: () => listDeviceTasks(token!), enabled: Boolean(token), staleTime: 0 });
  const heartbeat = useMutation({ mutationFn: () => heartbeatDevice(token!), onSuccess: () => tasks.refetch() });
  return <SafeAreaView style={styles.safe} edges={['top']}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.row}><ActionButton label="返回" tone="quiet" onPress={() => router.back()} /><Text style={styles.title}>手机任务</Text></View>
    <Surface>
      <Text style={styles.heading}>可信设备心跳</Text>
      <Text style={styles.body}>向当前隔离环境报告这台手机在线；没有设备签名时不会发送。</Text>
      <ActionButton label={heartbeat.isPending ? '发送中…' : '发送心跳'} onPress={() => heartbeat.mutate()} disabled={!token || heartbeat.isPending} />
      {heartbeat.isSuccess ? <Text style={styles.good}>已由服务器确认：{new Date(heartbeat.data.lastHeartbeatAt).toLocaleString('zh-CN')}</Text> : null}
      {heartbeat.isError ? <Text style={styles.error}>未获得服务器确认；设备状态不会标记为在线。</Text> : null}
    </Surface>
    <View style={styles.row}><Text style={styles.heading}>分配给这台手机的任务</Text><ActionButton label="刷新" tone="quiet" onPress={() => tasks.refetch()} disabled={!token || tasks.isFetching} /></View>
    {tasks.isError ? <Surface><Text style={styles.error}>任务读取失败；请检查登录、设备授权和网络。</Text></Surface> : null}
    {tasks.isSuccess && tasks.data.length === 0 ? <Surface><Text style={styles.body}>暂无待处理任务。</Text></Surface> : null}
    {tasks.data?.map((task) => <Surface key={task.id}>
      <Text style={styles.heading}>{task.taskType}</Text>
      <Text style={styles.body}>{task.resourceType} · {task.status}</Text>
      <Text style={styles.note}>执行结果必须来自真实设备采集。当前页面不会模拟 UI 节点或自动完成任务。</Text>
      <ActionButton label="查看任务与证据" tone="quiet" onPress={() => router.push(`/connections/device-tasks/${task.id}`)} />
    </Surface>)}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.page, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { ...typography.display, color: colors.text },
  heading: { ...typography.cardTitle, color: colors.text },
  body: { ...typography.body, color: colors.textSecondary, marginVertical: spacing.sm },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  good: { ...typography.caption, color: colors.primary, marginTop: spacing.sm },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
});
