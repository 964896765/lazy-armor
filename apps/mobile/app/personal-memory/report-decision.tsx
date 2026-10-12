import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text } from 'react-native';
import type { PersonalMemory, MemorySettings, ReportDecisionSource } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Card, Field, Button, ui } from '../../src/editor-ui';
import { ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryMutationError } from '../../src/memory-presenter';

export default function ReportDecisionPage() {
  const { conversationId, messageId } = useLocalSearchParams<{ conversationId: string; messageId: string }>(), token = useAuthStore(state => state.token), client = useQueryClient();
  const [requestId] = useState(() => `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const [decision, setDecision] = useState(''), [rationale, setRationale] = useState(''), [expectedOutcome, setExpectedOutcome] = useState('');
  const settings = useQuery({ queryKey: ['memory-settings', token], queryFn: () => api<MemorySettings>('/memory/settings', token), enabled: Boolean(token) });
  const query = useQuery({ queryKey: ['decision-report-source', token, conversationId, messageId], enabled: Boolean(token && conversationId && messageId),
    queryFn: () => api<ReportDecisionSource>(`/memory/report-decisions/source?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId)}`, token) });
  const save = useMutation({ mutationFn: () => api<PersonalMemory>('/memory/report-decisions', token, { method: 'POST', body: JSON.stringify({
    requestId, conversationId, messageId, reportRevision: query.data!.reportRevision, reportHash: query.data!.reportHash, decision, rationale, expectedOutcome, confirmed: true }) }),
    onSuccess: async memory => { await client.invalidateQueries({ queryKey: ['personal-memory'] }); await client.invalidateQueries({ queryKey: ['report-decisions'] });
      router.replace({ pathname: '/personal-memory/reference', params: { id: memory.id, version: String(memory.version) } } as never); } });
  const ready = Boolean(query.data);
  return <EditorPage title="我的决策">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState detail="当前报告尚未完成、已变化或不可读取，请返回报告核对。" onRetry={() => void query.refetch()} /> : query.data ? <Card title={query.data.title}>
      <Text style={ui.detail}>保存你的选择、理由和预期，绑定当前报告版本。它用于理解后续目标；不会启动计划、执行操作或把测算假设变成事实。</Text>
      {!ready ? <Text style={ui.detail}>报告尚未完成，暂不能保存决定。</Text> : null}
    </Card> : null}
    {settings.isError ? <ErrorState onRetry={() => void settings.refetch()} /> : null}
    {settings.data && !settings.data.enabled ? <Button secondary label="前往开启个人记忆" onPress={() => router.push('/personal-memory' as never)} /> : null}
    <Field label="我决定做什么" value={decision} onChange={setDecision} max={500} multiline />
    <Field label="选择这个方向的理由（可选）" value={rationale} onChange={setRationale} max={300} multiline />
    <Field label="预期结果（可选，尚未验证）" value={expectedOutcome} onChange={setExpectedOutcome} max={100} multiline />
    <Button label="确认保存我的决定" disabled={!ready || !settings.data?.enabled || !decision.trim() || save.isPending} onPress={() => Alert.alert('保存你的决定？', '你的选择与预期会用于后续目标理解，实际结果仍需独立验证。', [{ text: '取消' }, { text: '确认保存', onPress: () => save.mutate() }])} />
    {save.isError ? <><Text style={ui.error}>{memoryMutationError(save.error)}</Text><Button secondary label="重新读取报告版本" onPress={() => { save.reset(); void query.refetch(); }} /></> : null}
  </EditorPage>;
}
