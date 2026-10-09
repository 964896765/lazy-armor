import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text } from 'react-native';
import { MEMORY_TYPES, type MemoryType, type PersonalMemory } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Card, Field, Button, ui } from '../../src/editor-ui';
import { ChipTabs, LoadingState, ErrorState } from '../../src/consumer-ui';
import { memoryMutationError, memorySourceLabel, memoryTypeLabels } from '../../src/memory-presenter';
import { formatTime } from '../../src/plan-presenter';
export default function EditMemory() {
  const { id } = useLocalSearchParams<{ id?: string }>(), token = useAuthStore(state => state.token), client = useQueryClient();
  const [requestId] = useState(() => `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`), [type, setType] = useState<MemoryType>('PROFILE'), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const query = useQuery({ queryKey: ['memory-detail', id, token], queryFn: () => api<PersonalMemory>(`/memory/${id}`, token), enabled: Boolean(id && token) });
  useEffect(() => { if (query.data) { setTitle(query.data.title); setContent(query.data.content); setType(query.data.type); } }, [query.data]);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['personal-memory'] }); router.canGoBack() ? router.back() : router.replace('/personal-memory' as never); };
  const save = useMutation({ mutationFn: () => api<PersonalMemory>(id ? `/memory/${id}` : '/memory', token, { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ type, title, content, confirmed: true, ...(id ? { version: query.data!.version, expiresAt: query.data!.expiresAt } : { requestId }) }) }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/memory/${id}`, token, { method: 'DELETE', body: JSON.stringify({ version: query.data!.version }) }), onSuccess: refresh });
  if (id && query.isLoading) return <EditorPage title="个人信息"><LoadingState /></EditorPage>;
  if (id && query.isError) return <EditorPage title="个人信息"><ErrorState onRetry={() => void query.refetch()} /></EditorPage>;
  const busy = save.isPending || remove.isPending;
  return <EditorPage title={id ? '个人信息' : '添加个人信息'}>
    <Card title="分类"><ChipTabs value={type} options={MEMORY_TYPES.map(value => ({ value, label: memoryTypeLabels[value] }))} onChange={value => setType(value as MemoryType)} /></Card>
    <Field label="名称" value={title} onChange={setTitle} max={120} /><Field label="信息" value={content} onChange={setContent} multiline max={1000} />
    {query.data ? <Text style={ui.detail}>来源：{memorySourceLabel(query.data)}{ '\n' }保存于：{formatTime(query.data.confirmedAt)}</Text> : null}
    <Text style={ui.detail}>点击保存表示确认这条个人信息，供 AI 理解后续目标。它不会创建计划或修改已验证事实。</Text>
    <Button label="确认保存" disabled={busy || !token || !title.trim() || !content.trim() || Boolean(id && !query.data)} onPress={() => save.mutate()} />
    {id ? <Button secondary label="删除这条信息" disabled={busy || !query.data} onPress={() => Alert.alert('删除个人信息？', '删除后，后续目标理解不再使用这条信息。', [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => remove.mutate() }])} /> : null}
    {save.isError || remove.isError ? <><Text style={ui.error}>{memoryMutationError(save.error ?? remove.error)}</Text>{id ? <Button secondary label="重新读取" onPress={() => { save.reset(); remove.reset(); void query.refetch(); }} /> : null}</> : null}
  </EditorPage>;
}
