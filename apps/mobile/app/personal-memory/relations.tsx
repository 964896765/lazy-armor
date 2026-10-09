import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, Text } from 'react-native';
import { MEMORY_RELATIONS, type MemoryRelation, type MemoryRelationType, type MemorySettings, type PersonalMemory } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Card, Button, ui } from '../../src/editor-ui';
import { ChipTabs, ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryMutationError, memoryRelationLabels } from '../../src/memory-presenter';

export default function MemoryRelationsPage() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(state => state.token), client = useQueryClient();
  const [cursor, setCursor] = useState<string>(), [relationCursor, setRelationCursor] = useState<string>(), [to, setTo] = useState<PersonalMemory>(), [kind, setKind] = useState<MemoryRelationType>('RELATED_TO');
  const [requestId, setRequestId] = useState(() => `memory-relation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const memory = useQuery({ queryKey: ['memory-detail', id, token], queryFn: () => api<PersonalMemory>(`/memory/${id}`, token), enabled: Boolean(id && token) });
  const settings = useQuery({ queryKey: ['memory-settings', token], queryFn: () => api<MemorySettings>('/memory/settings', token), enabled: Boolean(token) });
  const relations = useQuery({ queryKey: ['memory-relations', token, id, relationCursor], queryFn: () => api<{ items: MemoryRelation[]; nextCursor: string | null }>(`/memory/${id}/relations?limit=20${relationCursor ? '&cursor=' + encodeURIComponent(relationCursor) : ''}`, token), enabled: Boolean(id && token) });
  const options = useQuery({ queryKey: ['memory-relation-options', token, cursor], queryFn: () => api<{ items: PersonalMemory[]; nextCursor: string | null }>(`/memory?limit=20${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token), enabled: Boolean(token) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['memory-relations'] }); };
  const create = useMutation({ mutationFn: () => api(`/memory/${id}/relations`, token, { method: 'POST', body: JSON.stringify({ requestId, fromVersion: memory.data!.version, toId: to!.id, toVersion: to!.version, relation: kind, confirmed: true }) }),
    onSuccess: async () => { setTo(undefined); setRequestId(`memory-relation-${Date.now()}-${Math.random().toString(16).slice(2)}`); await refresh(); } });
  const remove = useMutation({ mutationFn: (edge: MemoryRelation) => api(`/memory/relations/${edge.id}`, token, { method: 'DELETE', body: JSON.stringify({ version: edge.version }) }), onSuccess: refresh });
  const busy = create.isPending || remove.isPending;
  return <EditorPage title="个人信息关联">
    {memory.isLoading ? <LoadingState /> : memory.isError ? <ErrorState onRetry={() => void memory.refetch()} /> : <Text style={ui.title}>{memory.data?.title}</Text>}
    <Text style={ui.detail}>关联由你确认，可帮助后续目标理解。更正或删除任一信息后，需要重新核对关联。</Text>
    {relations.isLoading ? <LoadingState /> : relations.isError ? <ErrorState onRetry={() => void relations.refetch()} /> : relations.data?.items.length ? relations.data.items.map(edge => <Card key={edge.id} title={`${edge.fromTitle} → ${memoryRelationLabels[edge.relation]} → ${edge.toTitle}`}>
      <Button secondary label="查看关联信息" onPress={() => router.push({ pathname: '/personal-memory/reference', params: { id: edge.fromId === id ? edge.toId : edge.fromId, version: String(edge.fromId === id ? edge.toVersion : edge.fromVersion) } } as never)} />
      <Button secondary label="移除关联" disabled={busy} onPress={() => Alert.alert('移除这条关联？', '个人信息本身仍然保留。', [{ text: '取消' }, { text: '移除', onPress: () => remove.mutate(edge) }])} />
    </Card>) : <Text style={ui.detail}>还没有当前有效的关联。</Text>}
    {relations.data?.nextCursor ? <Button secondary label="较早关联" onPress={() => setRelationCursor(relations.data!.nextCursor!)} /> : null}
    {relationCursor ? <Button secondary label="最近关联" onPress={() => setRelationCursor(undefined)} /> : null}
    <Card title="添加关联">
      <ChipTabs value={kind} options={MEMORY_RELATIONS.map(value => ({ value, label: memoryRelationLabels[value] }))} onChange={value => { if (!busy) { setKind(value as MemoryRelationType); setRequestId(`memory-relation-${Date.now()}-${Math.random().toString(16).slice(2)}`); } }} />
      {options.isLoading ? <LoadingState /> : options.isError ? <ErrorState onRetry={() => void options.refetch()} /> : options.data?.items.filter(item => item.id !== id && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())).map(item =>
        <Pressable key={item.id} accessibilityRole="button" disabled={busy} accessibilityState={{ selected: item.id === to?.id }} style={ui.row} onPress={() => { setTo(item); setRequestId(`memory-relation-${Date.now()}-${Math.random().toString(16).slice(2)}`); }}><Text style={ui.title}>{item.title}{item.id === to?.id ? ' · 已选' : ''}</Text></Pressable>)}
      {options.data?.nextCursor ? <Button secondary label="更多个人信息" onPress={() => setCursor(options.data!.nextCursor!)} /> : null}
      {cursor ? <Button secondary label="最近个人信息" onPress={() => setCursor(undefined)} /> : null}
      {to && memory.data ? <Text style={ui.detail}>{memory.data.title} → {memoryRelationLabels[kind]} → {to.title}</Text> : null}
      {!settings.data?.enabled ? <Text style={ui.detail}>开启个人记忆后可以确认新的关联。</Text> : null}
      <Button label="确认添加关联" disabled={busy || !to || !memory.data || !settings.data?.enabled || Boolean(memory.data?.expiresAt && Date.parse(memory.data.expiresAt) <= Date.now())} onPress={() => create.mutate()} />
    </Card>
    {create.isError || remove.isError ? <><Text style={ui.error}>{memoryMutationError(create.error ?? remove.error)}</Text><Button secondary label="重新读取" onPress={() => { create.reset(); remove.reset(); void memory.refetch(); void options.refetch(); void relations.refetch(); }} /></> : null}
  </EditorPage>;
}
