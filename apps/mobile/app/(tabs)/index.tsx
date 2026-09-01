import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Button, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { styles } from '../../src/shell';
import { approvalRiskText, notificationPriorityLabel, riskLevelLabel, todayState } from '../../src/today-presenter';
import { executionStatusLabel } from '../../src/execution-presenter';

interface ApprovalCard { id: string; executionId: string; riskLevel: string; summary: string; expiresAt: string; planName: string }
interface AlertCard { id: string; priority: string; title: string; body: string; executionId: string | null; createdAt: string }
interface ProcessedCard { id: string; status: string; resultSummary: string | null; finishedAt: string | null; planName: string; planVersionNumber: number }
interface TodayData { pendingApprovals: ApprovalCard[]; alerts: AlertCard[]; processed: ProcessedCard[] }

export default function Today() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const today = useQuery({ queryKey: ['today', token], queryFn: () => api<TodayData>('/today', token), enabled: Boolean(token), refetchInterval: 5000 });
  const decide = useMutation({
    mutationFn: ({ id, decision, risk }: { id: string; decision: 'approve' | 'reject'; risk: string }) => api(`/approvals/${id}/${decision}`, token, { method: 'POST', body: JSON.stringify(decision === 'approve' && risk === 'R4' ? { confirmation: 'APPROVE_R4', deviceId: 'mobile' } : { deviceId: 'mobile' }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['today', token] }); },
  });
  const count = (today.data?.pendingApprovals.length ?? 0) + (today.data?.alerts.length ?? 0) + (today.data?.processed.length ?? 0);
  const state = todayState(Boolean(token), today.isLoading, today.isError, count);
  const confirm = (approval: ApprovalCard, decision: 'approve' | 'reject') => Alert.alert(decision === 'approve' ? '确认继续？' : '确认拒绝？', approval.summary, [
    { text: '返回', style: 'cancel' },
    { text: decision === 'approve' ? '确认继续' : '拒绝', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => decide.mutate({ id: approval.id, decision, risk: approval.riskLevel }) },
  ]);
  return <ScrollView style={local.page} contentContainerStyle={local.content} refreshControl={token ? <RefreshControl refreshing={today.isFetching} onRefresh={() => today.refetch()} /> : undefined}>
    <Text style={styles.eyebrow}>懒人装甲 · P0</Text><Text style={styles.title}>今天</Text><Text style={styles.subtitle}>先看有没有必须由你处理的事情。</Text>
    {state === 'signed_out' && <View style={styles.card}><Text style={styles.cardTitle}>登录后查看今天</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>}
    {state === 'loading' && <ActivityIndicator />}
    {state === 'error' && <View style={styles.card}><Text style={styles.cardTitle}>今天暂时加载失败</Text><Button title="重新加载" onPress={() => today.refetch()} /></View>}
    {state === 'empty' && <View style={styles.card}><Text style={styles.cardTitle}>目前没有待处理事项</Text><Text style={styles.cardText}>正常完成的自动化保持安静，可在“记录”中查看。</Text></View>}
    {today.data?.pendingApprovals.map((item) => <View style={[styles.card, local.approval]} key={item.id}><Text style={local.section}>需要确认 · {riskLevelLabel(item.riskLevel)}</Text><Text style={styles.cardTitle}>{item.planName}</Text><Text style={styles.cardText}>{item.summary}</Text><Text style={styles.cardText}>{approvalRiskText(item.riskLevel)} · {new Date(item.expiresAt).toLocaleTimeString('zh-CN')} 前有效</Text><View style={local.actions}><Button title="拒绝" color="#9B3A32" onPress={() => confirm(item, 'reject')} disabled={decide.isPending} /><Button title="确认继续" onPress={() => confirm(item, 'approve')} disabled={decide.isPending} /></View></View>)}
    {today.data?.alerts.map((item) => <View style={styles.card} key={item.id}><Text style={local.section}>{notificationPriorityLabel(item.priority)}</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardText}>{item.body}</Text>{item.executionId && <Button title="查看执行记录" onPress={() => router.push(`/executions/${item.executionId}` as never)} />}</View>)}
    {(today.data?.processed.length ?? 0) > 0 && <Text style={local.heading}>已处理摘要</Text>}
    {today.data?.processed.map((item) => <View style={styles.card} key={item.id}><Text style={styles.cardTitle}>{item.planName}</Text><Text style={styles.cardText}>计划 V{item.planVersionNumber} · {item.resultSummary ?? executionStatusLabel(item.status)}</Text></View>)}
  </ScrollView>;
}

const local = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 24, paddingTop: 52 }, approval: { borderColor: '#F2A65A', borderWidth: 2 }, section: { color: '#C65C16', fontWeight: '800', marginBottom: 8 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 14 }, heading: { fontSize: 18, fontWeight: '800', color: '#24342C', marginTop: 12, marginBottom: 10 } });
