import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text } from 'react-native';
import type { LearningCandidate } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Button, Card, Field, ui } from '../../src/editor-ui';
import { ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryMutationError } from '../../src/memory-presenter';
import { learningOutcomeLabel, learningStatusLabel } from '../../src/learning-presenter';
import { formatTime } from '../../src/plan-presenter';

export default function LearningReview() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(state => state.token), client = useQueryClient(), [feedback, setFeedback] = useState('');
  const query = useQuery({ queryKey: ['learning-candidate', token, id], queryFn: () => api<LearningCandidate>(`/memory/learning-candidates/${id}`, token), enabled: Boolean(token && id) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['learning-candidates'] }); await client.invalidateQueries({ queryKey: ['personal-memory'] }); };
  const confirm = useMutation({ mutationFn: () => api<{ memoryId: string; confirmedMemoryVersion: number }>(`/memory/learning-candidates/${id}/confirm`, token,
    { method: 'POST', body: JSON.stringify({ version: query.data!.version, confirmed: true, feedback }) }),
    onSuccess: async result => { await refresh(); router.replace({ pathname: '/personal-memory/reference', params: { id: result.memoryId, version: String(result.confirmedMemoryVersion) } } as never); } });
  const dismiss = useMutation({ mutationFn: () => api(`/memory/learning-candidates/${id}/dismiss`, token, { method: 'POST', body: JSON.stringify({ version: query.data!.version }) }),
    onSuccess: async () => { await refresh(); router.replace('/personal-memory/learning' as never); } });
  const row = query.data, busy = confirm.isPending || dismiss.isPending;
  return <EditorPage title="核对经验与反馈">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : row ? <>
      <Text style={ui.detail}>{learningStatusLabel(row.status)}</Text>
      {row.status === 'PENDING' && row.source ? <>
        <Card title={row.source.scope} detail={learningOutcomeLabel(row.source.outcome)}><Text selectable style={ui.detail}>{row.content}</Text>
          <Text style={ui.detail}>适用范围：本次操作 · 样本数 1 · 核验于 {formatTime(row.source.verifiedAt)}{ '\n' }有效至 {formatTime(row.expiresAt)}</Text>
          <Button secondary label="查看原始操作与验证" onPress={() => router.push({ pathname: '/executions/[id]', params: { id: row.source!.executionId } } as never)} />
        </Card>
        <Field label="我的反馈（可选，作为个人判断保存）" value={feedback} onChange={setFeedback} max={500} multiline />
        <Text style={ui.detail}>保存后可作为历史经验供后续规划参考。它不会新增授权或修改正在执行的计划；你可以关闭使用、编辑或删除。</Text>
        <Button label="确认保存历史经验" disabled={busy} onPress={() => Alert.alert('保存这次历史经验？', '确认后，本次核验结果和你的反馈会用于理解后续目标。', [{ text: '取消' }, { text: '确认保存', onPress: () => confirm.mutate() }])} />
        <Button secondary label="忽略，不保存" disabled={busy} onPress={() => dismiss.mutate()} />
      </> : row.memoryId ? <Button secondary label="查看已保存的经验" onPress={() => router.replace({ pathname: '/personal-memory/reference', params: { id: row.memoryId!, version: String(row.confirmedMemoryVersion) } } as never)} /> : <Text style={ui.detail}>这条建议不会用于后续规划。</Text>}
    </> : null}
    {confirm.isError || dismiss.isError ? <><Text style={ui.error}>{memoryMutationError(confirm.error ?? dismiss.error)}</Text><Button secondary label="重新读取建议" onPress={() => { confirm.reset(); dismiss.reset(); void query.refetch(); }} /></> : null}
  </EditorPage>;
}
