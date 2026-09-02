import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { executionAttentionLabel, executionListState, executionNeedsAttention, executionStatusLabel } from '../../src/execution-presenter';
import { styles } from '../../src/shell';

interface ExecutionRecord {
  id: string;
  planName: string;
  status: string;
  resultSummary: string | null;
  createdAt: string;
}

export default function Records() {
  const token = useAuthStore((state) => state.token);
  const executions = useQuery({ queryKey: ['executions', token], queryFn: () => api<ExecutionRecord[]>('/executions', token), enabled: Boolean(token) });
  const state = executionListState(executions.isLoading, executions.isError, executions.data?.length ?? 0);
  return (
    <ScrollView style={local.page} contentContainerStyle={local.content} refreshControl={token ? <RefreshControl refreshing={executions.isFetching} onRefresh={() => executions.refetch()} /> : undefined}>
      <Text style={styles.eyebrow}>懒人装甲</Text><Text style={styles.title}>记录</Text><Text style={styles.subtitle}>只看用户有价值的结果，方便你回头确认它做了什么、有没有需要继续处理。</Text>
      {!token && <View style={styles.card}><Text style={styles.cardTitle}>登录后查看真实记录</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>}
      {state === 'loading' && <ActivityIndicator />}
      {state === 'error' && <View style={styles.card}><Text style={styles.cardTitle}>记录暂时加载失败</Text><Button title="重新加载" onPress={() => executions.refetch()} /></View>}
      {state === 'empty' && <View style={styles.card}><Text style={styles.cardTitle}>暂无执行记录</Text><Text style={styles.cardText}>手动运行一个已启用计划后，记录会出现在这里。</Text></View>}
      {state === 'ready' && executions.data?.map((item) => <Pressable key={item.id} onPress={() => router.push(`/executions/${item.id}` as never)}><View style={styles.card}><View style={local.row}><Text style={local.time}>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Text><Text style={[local.status, executionNeedsAttention(item.status) ? local.statusWarning : null]}>{executionAttentionLabel(item.status)}</Text></View><Text style={styles.cardTitle}>{item.planName}</Text><Text style={styles.cardText}>做了什么：{item.resultSummary ?? executionStatusLabel(item.status)}</Text><Text style={styles.cardText}>结果：{executionNeedsAttention(item.status) ? '这次还需要你看一下' : '这次已经自动处理完成'}</Text></View></Pressable>)}
    </ScrollView>
  );
}

const local = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 24, paddingTop: 52 }, row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }, time: { color: '#69756F' }, status: { color: '#287052', fontWeight: '700' }, statusWarning: { color: '#A63D3D' } });
