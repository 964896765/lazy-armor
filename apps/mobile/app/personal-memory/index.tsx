import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Switch, Text, View } from 'react-native';
import type { MemorySettings, PersonalMemory } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Card, Button, ui } from '../../src/editor-ui';
import { ErrorState, LoadingState, EmptyState } from '../../src/consumer-ui';
import { memorySourceLabel, memoryTypeLabels } from '../../src/memory-presenter';
export default function PersonalMemoryPage() {
  const token = useAuthStore(state => state.token), client = useQueryClient();
  const [cursor, setCursor] = useState<string>();
  const settings = useQuery({ queryKey: ['memory-settings', token], queryFn: () => api<MemorySettings>('/memory/settings', token), enabled: Boolean(token) });
  const query = useQuery({ queryKey: ['personal-memory', token, cursor], queryFn: () => api<{ items: PersonalMemory[]; nextCursor: string | null }>(`/memory?limit=20${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token), enabled: Boolean(token) });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api<MemorySettings>('/memory/settings', token, { method: 'PATCH', body: JSON.stringify({ enabled, version: settings.data!.version }) }),
    onSuccess: data => client.setQueryData(['memory-settings', token], data), onError: () => void settings.refetch() });
  return <EditorPage title="个人记忆">
    <Card title="用于理解我的目标" detail="开启后，你确认保存的信息会提供给当前 AI，用于后续目标理解。会话也可提出个人记忆建议，核对后才保存。可以随时关闭使用、编辑或删除。">
      {settings.isLoading ? <LoadingState /> : settings.isError ? <ErrorState onRetry={() => void settings.refetch()} /> : <View style={ui.line}><Text style={[ui.title, { flex: 1 }]}>{settings.data?.enabled ? '已开启' : '已关闭'}</Text><Switch accessibilityLabel="使用个人记忆" value={settings.data?.enabled ?? false} disabled={!settings.data || toggle.isPending} onValueChange={value => toggle.mutate(value)} /></View>}
      {toggle.isError ? <Text style={ui.error}>设置未保存，已重新读取当前状态。</Text> : null}
    </Card>
    <Button label="添加个人信息" disabled={!settings.data?.enabled} onPress={() => router.push('/personal-memory/edit' as never)} />
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? query.data.items.map(memory =>
      <Pressable accessibilityRole="button" key={memory.id} onPress={() => router.push({ pathname: '/personal-memory/edit', params: { id: memory.id } } as never)} style={ui.card}>
        <Text style={ui.title}>{memory.title}</Text><Text style={ui.detail}>{memoryTypeLabels[memory.type]}</Text><Text style={ui.detail} numberOfLines={3}>{memory.content}</Text><Text style={ui.detail}>{memorySourceLabel(memory)} ›</Text>
      </Pressable>) : <EmptyState title="尚未保存个人信息" detail="只保存你明确确认的信息。来源、修改和删除由你掌握。" />}
    {query.data?.nextCursor ? <Button secondary label="下一页" onPress={() => setCursor(query.data!.nextCursor!)} /> : null}
    {cursor ? <Button secondary label="返回最近信息" onPress={() => setCursor(undefined)} /> : null}
  </EditorPage>;
}
