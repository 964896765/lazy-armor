import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { MEMORY_TYPES, type MemoryCandidate, type MemoryType } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Button, Card, Field, ui } from '../../src/editor-ui';
import { ChipTabs, ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryMutationError, memoryTypeLabels } from '../../src/memory-presenter';

export default function MemoryCandidatePage() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(state => state.token), client = useQueryClient();
  const [type, setType] = useState<MemoryType>('PROFILE'), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const query = useQuery({ queryKey: ['memory-candidate', token, id], queryFn: () => api<MemoryCandidate>(`/memory/candidates/${id}`, token), enabled: Boolean(token && id) });
  useEffect(() => { if (query.data?.status === 'PENDING') { setType(query.data.type); setTitle(query.data.title ?? ''); setContent(query.data.quote ?? ''); } }, [query.data]);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['memory-candidates'] }); await client.invalidateQueries({ queryKey: ['personal-memory'] }); };
  const confirm = useMutation({ mutationFn: () => api<{ memoryId: string; confirmedMemoryVersion: number }>(`/memory/candidates/${id}/confirm`, token, { method: 'POST', body: JSON.stringify({ type, title, content, confirmed: true, version: query.data!.version }) }),
    onSuccess: async result => { await refresh(); router.replace({ pathname: '/personal-memory/reference', params: { id: result.memoryId, version: String(result.confirmedMemoryVersion) } } as never); } });
  const dismiss = useMutation({ mutationFn: () => api(`/memory/candidates/${id}/dismiss`, token, { method: 'POST', body: JSON.stringify({ version: query.data!.version }) }),
    onSuccess: async () => { await refresh(); router.canGoBack() ? router.back() : router.replace('/personal-memory' as never); } });
  return <EditorPage title="核对个人信息">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState detail="这条建议或来源暂不可读取。" onRetry={() => void query.refetch()} /> : query.data?.status === 'PENDING' ? <>
      <Card title="来自你在会话中提供的信息"><Text selectable style={ui.detail}>{query.data.quote}</Text><Text style={ui.detail}>AI 提取仅是建议。请核对或更正，再决定是否保存为个人记忆。</Text></Card>
      <ChipTabs value={type} options={MEMORY_TYPES.map(value => ({ value, label: memoryTypeLabels[value] }))} onChange={value => setType(value as MemoryType)} />
      <Field label="名称" value={title} onChange={setTitle} max={120} /><Field label="个人信息" value={content} onChange={setContent} multiline max={1000} />
      <Button label="确认保存为个人记忆" disabled={!title.trim() || !content.trim() || confirm.isPending || dismiss.isPending} onPress={() => confirm.mutate()} />
      <Button secondary label="忽略，不保存" disabled={confirm.isPending || dismiss.isPending} onPress={() => dismiss.mutate()} />
    </> : <><Text style={ui.detail}>{query.data?.status === 'CONFIRMED' ? '这条信息已经确认保存。' : '这条建议已忽略或失效。'}</Text>
      {query.data?.memoryId ? <Button secondary label="查看个人信息" onPress={() => router.replace({ pathname: '/personal-memory/reference', params: { id: query.data!.memoryId!, version: String(query.data!.confirmedMemoryVersion) } } as never)} /> : null}</>}
    {confirm.isError || dismiss.isError ? <Text style={ui.error}>{memoryMutationError(confirm.error ?? dismiss.error)}</Text> : null}
  </EditorPage>;
}
