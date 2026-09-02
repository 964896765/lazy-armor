import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Button, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { styles } from '../../src/shell';
import { approvalRiskText, notificationPriorityLabel, riskLevelLabel, todayState } from '../../src/today-presenter';
import { executionStatusLabel } from '../../src/execution-presenter';
import { connectionRecoveryAction, connectionStatusExplanation, connectionStatusLabel, connectionStatusNextStep, consumerErrorMessage, consumerErrorNextStep } from '../../src/connection-presenter';

interface ApprovalCard { id: string; executionId: string; riskLevel: string; summary: string; expiresAt: string; planName: string }
interface AlertCard { id: string; priority: string; title: string; body: string; executionId: string | null; createdAt: string }
interface ProcessedCard { id: string; status: string; resultSummary: string | null; finishedAt: string | null; planName: string; planVersionNumber: number }
interface ConnectionIssue { connectionId: string; connectionStatus: string; providerKey: string; providerName: string; planId: string; planName: string }
interface TodayData { pendingApprovals: ApprovalCard[]; connectionIssues: ConnectionIssue[]; alerts: AlertCard[]; processed: ProcessedCard[] }
interface PresentableAlert extends AlertCard { section: 'attention' | 'exception' | 'summary' }

export default function Today() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const today = useQuery({ queryKey: ['today', token], queryFn: () => api<TodayData>('/today', token), enabled: Boolean(token), refetchInterval: 5000 });
  const decide = useMutation({
    mutationFn: ({ id, decision, risk }: { id: string; decision: 'approve' | 'reject'; risk: string }) => api(`/approvals/${id}/${decision}`, token, { method: 'POST', body: JSON.stringify(decision === 'approve' && risk === 'R4' ? { confirmation: 'APPROVE_R4', deviceId: 'mobile' } : { deviceId: 'mobile' }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['today', token] }); },
  });
  const presentableAlerts = (today.data?.alerts ?? []).map((item) => ({
    ...item,
    section: classifyAlert(item),
  })) satisfies PresentableAlert[];
  const attentionAlerts = presentableAlerts.filter((item) => item.section === 'attention');
  const exceptionAlerts = presentableAlerts.filter((item) => item.section === 'exception');
  const summaryAlerts = presentableAlerts.filter((item) => item.section === 'summary');
  const count = (today.data?.pendingApprovals.length ?? 0)
    + (today.data?.connectionIssues.length ?? 0)
    + attentionAlerts.length
    + exceptionAlerts.length
    + summaryAlerts.length
    + (today.data?.processed.length ?? 0);
  const state = todayState(Boolean(token), today.isLoading, today.isError, count);
  const confirm = (approval: ApprovalCard, decision: 'approve' | 'reject') => Alert.alert(decision === 'approve' ? '确认继续？' : '确认拒绝？', approval.summary, [
    { text: '返回', style: 'cancel' },
    { text: decision === 'approve' ? '确认继续' : '拒绝', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => decide.mutate({ id: approval.id, decision, risk: approval.riskLevel }) },
  ]);
  return <ScrollView style={local.page} contentContainerStyle={local.content} refreshControl={token ? <RefreshControl refreshing={today.isFetching} onRefresh={() => today.refetch()} /> : undefined}>
    <Text style={styles.eyebrow}>懒人装甲</Text><Text style={styles.title}>今天</Text><Text style={styles.subtitle}>先看有没有必须由你处理的事情。</Text>
    {state === 'signed_out' && <View style={styles.card}><Text style={styles.cardTitle}>登录后查看今天</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>}
    {state === 'loading' && <ActivityIndicator />}
    {state === 'error' && <View style={styles.card}><Text style={styles.cardTitle}>今天暂时加载失败</Text><Button title="重新加载" onPress={() => today.refetch()} /></View>}
    {state === 'empty' && <View style={styles.card}><Text style={styles.cardTitle}>目前没有待处理事项</Text><Text style={styles.cardText}>正常完成的自动化保持安静，可在“记录”中查看。</Text></View>}
    {((today.data?.pendingApprovals.length ?? 0) > 0 || (today.data?.connectionIssues.length ?? 0) > 0 || attentionAlerts.length > 0) && <Text style={local.heading}>需要你处理</Text>}
    {today.data?.pendingApprovals.map((item) => <View style={[styles.card, local.approval]} key={item.id}><Text style={local.section}>需要确认</Text><Text style={styles.cardTitle}>{item.planName}</Text><Text style={styles.cardText}>{item.summary}</Text><Text style={styles.cardText}>{approvalRiskText(item.riskLevel)}</Text><Text style={styles.cardText}>{new Date(item.expiresAt).toLocaleTimeString('zh-CN')} 前有效 · {riskLevelLabel(item.riskLevel)}</Text><View style={local.actions}><Button title="拒绝" color="#9B3A32" onPress={() => confirm(item, 'reject')} disabled={decide.isPending} /><Button title="确认继续" onPress={() => confirm(item, 'approve')} disabled={decide.isPending} /></View></View>)}
    {today.data?.connectionIssues.map((item) => <View style={[styles.card, local.connectionIssue]} key={`${item.planId}:${item.connectionId}`}><Text style={local.section}>连接需要处理</Text><Text style={styles.cardTitle}>{item.providerName} · {connectionStatusLabel(item.connectionStatus)}</Text><Text style={styles.cardText}>{connectionStatusExplanation(item.connectionStatus)}</Text><Text style={styles.cardText}>“{item.planName}”会保留当前设置，补好连接后会继续运行。</Text><Text style={styles.cardText}>{connectionStatusNextStep(item.connectionStatus)}</Text><Button title={connectionRecoveryAction(item.connectionStatus) ?? '查看连接'} onPress={() => router.push('/connections')} /></View>)}
    {attentionAlerts.map((item) => <View style={[styles.card, local.connectionIssue]} key={item.id}><Text style={local.section}>需要你处理</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardText}>{consumerErrorMessage(item.body)}</Text><Text style={styles.cardText}>{consumerErrorNextStep(item.body)}</Text>{item.executionId && <Button title="查看记录" onPress={() => router.push(`/executions/${item.executionId}` as never)} />}</View>)}

    {exceptionAlerts.length > 0 && <Text style={local.heading}>异常</Text>}
    {exceptionAlerts.map((item) => <View style={styles.card} key={item.id}><Text style={local.section}>{notificationPriorityLabel(item.priority)}</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardText}>{consumerErrorMessage(item.body)}</Text><Text style={styles.cardText}>{consumerErrorNextStep(item.body)}</Text>{item.executionId && <Button title="查看记录" onPress={() => router.push(`/executions/${item.executionId}` as never)} />}</View>)}

    {summaryAlerts.length > 0 && <Text style={local.heading}>每日摘要</Text>}
    {summaryAlerts.map((item) => <View style={styles.card} key={item.id}><Text style={local.section}>今天的重点</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardText}>{consumerErrorMessage(item.body)}</Text>{item.executionId && <Button title="查看记录" onPress={() => router.push(`/executions/${item.executionId}` as never)} />}</View>)}

    {(today.data?.processed.length ?? 0) > 0 && <Text style={local.heading}>已处理</Text>}
    {today.data?.processed.map((item) => <View style={styles.card} key={item.id}><Text style={styles.cardTitle}>{item.planName}</Text><Text style={styles.cardText}>{item.resultSummary ?? executionStatusLabel(item.status)}</Text><Text style={styles.cardText}>{item.finishedAt ? `${new Date(item.finishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 已处理完毕` : '结果已进入记录，可随时回看'}</Text></View>)}
  </ScrollView>;
}

function classifyAlert(item: AlertCard): PresentableAlert['section'] {
  const normalized = `${item.title} ${item.body}`.toLowerCase();
  if (
    item.priority === 'P0'
    || normalized.includes('需要你')
    || normalized.includes('等待你')
    || normalized.includes('重新连接')
    || normalized.includes('重新授权')
    || normalized.includes('确认')
  ) {
    return 'attention';
  }
  if (item.priority === 'P2' || normalized.includes('摘要') || normalized.includes('重点')) {
    return 'summary';
  }
  return 'exception';
}

const local = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 24, paddingTop: 52 }, approval: { borderColor: '#F2A65A', borderWidth: 2 }, connectionIssue: { borderColor: '#E18A3B', borderWidth: 2 }, section: { color: '#C65C16', fontWeight: '800', marginBottom: 8 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 14 }, heading: { fontSize: 18, fontWeight: '800', color: '#24342C', marginTop: 12, marginBottom: 10 } });
