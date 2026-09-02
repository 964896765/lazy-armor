import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { executionAttentionLabel, executionNeedsAttention, executionStatusLabel, executionStepMark, executionStepSummary, sortExecutionSteps } from '../../src/execution-presenter';
import { actionSummary } from '../../src/plan-presenter';
import { approvalStatusLabel } from '../../src/today-presenter';
import { consumerErrorMessage, consumerErrorNextStep } from '../../src/connection-presenter';
import { styles } from '../../src/shell';

interface Step { id: string; stepOrder: number; actionType: string; status: string; retryCount: number; errorMessage: string | null; effectiveRiskLevel: string | null; approvalGateStatus: string | null }
interface ApprovalInfo { id: string; executionStepId: string; status: string; effectiveRiskLevel: string; actionSummary: string; reason: string | null; requestedAt: string | null; decidedAt: string | null; decision: string | null; decisionReason: string | null }
interface NotificationInfo { id: string; priority: string; title: string; body: string; status: string; createdAt: string }
interface Detail {
  planName: string; planVersionNumber: number; triggerType: string; status: string; resultSummary: string | null; errorMessage: string | null; createdAt: string;
  declaredRiskLevel: string; approvalStatus: string; steps: Step[]; approvals: ApprovalInfo[]; notifications: NotificationInfo[];
}
const POLLING_STATES = ['created', 'queued', 'running', 'retry_wait', 'waiting_approval'];
export default function ExecutionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const detail = useQuery({ queryKey: ['execution', id, token], queryFn: () => api<Detail>(`/executions/${id}`, token), enabled: Boolean(id && token), refetchInterval: (query) => POLLING_STATES.includes(query.state.data?.status ?? '') ? 2000 : false });
  return <ScrollView style={local.page} contentContainerStyle={local.content}>{detail.isLoading && <ActivityIndicator />}{detail.isError && <View style={styles.card}><Text style={styles.cardTitle}>记录详情暂时加载失败</Text></View>}{detail.data && <><Text style={styles.eyebrow}>执行记录</Text><Text style={styles.title}>{detail.data.planName}</Text><Text style={styles.subtitle}>{new Date(detail.data.createdAt).toLocaleString('zh-CN')} · {executionStatusLabel(detail.data.status)}</Text><View style={styles.card}><Text style={styles.cardTitle}>这次做了什么</Text><Text style={styles.cardText}>{detail.data.resultSummary ?? consumerErrorMessage(detail.data.errorMessage) ?? '正在处理'}</Text><Text style={styles.cardText}>{executionAttentionLabel(detail.data.status)}</Text></View>
  {executionNeedsAttention(detail.data.status) && <View style={[styles.card, local.approval]}><Text style={styles.cardTitle}>下一步怎么办</Text><Text style={styles.cardText}>{consumerErrorNextStep(detail.data.errorMessage)}</Text><Text style={styles.cardText}>当前确认状态：{approvalStatusLabel(detail.data.approvalStatus)}</Text></View>}
  {detail.data.approvals.map((approval) => <View style={[styles.card, local.approval]} key={approval.id}><Text style={styles.cardTitle}>需要你确认</Text><Text style={styles.cardText}>{approval.actionSummary}</Text><Text style={styles.cardText}>状态：{approvalStatusLabel(approval.status)}</Text>{approval.reason ? <Text style={styles.cardText}>为什么会叫你：{consumerErrorMessage(approval.reason)}</Text> : null}{approval.decidedAt ? <Text style={styles.cardText}>处理时间：{new Date(approval.decidedAt).toLocaleString('zh-CN')}</Text> : null}{approval.decisionReason ? <Text style={styles.cardText}>处理说明：{approval.decisionReason}</Text> : null}</View>)}
  {detail.data.notifications.length > 0 && <View style={styles.card}><Text style={styles.cardTitle}>相关提醒</Text>{detail.data.notifications.map((item) => <Text style={styles.cardText} key={item.id}>{item.title} · {consumerErrorMessage(item.body)}</Text>)}</View>}
  <View style={styles.card}><Text style={styles.cardTitle}>处理过程</Text>{sortExecutionSteps(detail.data.steps).map((step) => <View style={local.stepRow} key={step.id}><Text style={styles.cardText}>{executionStepMark(step.status)} {actionSummary(step.actionType, null)}</Text><Text style={styles.cardText}>{step.errorMessage ? consumerErrorMessage(step.errorMessage) : executionStepSummary(step.status)}</Text></View>)}</View>
  </>}</ScrollView>;
}
const local = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 24, paddingTop: 52 }, approval: { borderColor: '#F2A65A', borderWidth: 2 }, stepRow: { borderTopWidth: 1, borderTopColor: '#EDF0EE', paddingTop: 10, marginTop: 10 } });
