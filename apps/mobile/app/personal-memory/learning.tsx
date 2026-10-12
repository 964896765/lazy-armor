import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { LearningCandidate, MemorySettings } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Card, Button, ui } from '../../src/editor-ui';
import { EmptyState, ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryMutationError } from '../../src/memory-presenter';
import { learningOutcomeLabel, learningStatusLabel } from '../../src/learning-presenter';

export default function LearningPage() {
  const token = useAuthStore(state => state.token), client = useQueryClient(), [cursor, setCursor] = useState<string>();
  const settings = useQuery({ queryKey: ['memory-settings', token], queryFn: () => api<MemorySettings>('/memory/settings', token), enabled: Boolean(token) });
  const query = useQuery({ queryKey: ['learning-candidates', token, cursor],
    queryFn: () => api<{ items: LearningCandidate[]; nextCursor: string | null }>(`/memory/learning-candidates?limit=20${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token), enabled: Boolean(token) });
  const refresh = useMutation({ mutationFn: () => api<{ created: number }>('/memory/learning-candidates/refresh', token, { method: 'POST' }),
    onSuccess: async () => { setCursor(undefined); await client.invalidateQueries({ queryKey: ['learning-candidates'] }); } });
  return <EditorPage title="经验与反馈">
    <Card title="从结果中学习" detail="整理最近 30 天已核验的操作结果。每条只代表一个样本，由你核对后决定是否用于后续目标。失败和部分成功会如实保留；待核验结果不形成经验。">{null}</Card>
    {settings.isError ? <ErrorState onRetry={() => void settings.refetch()} /> : null}
    {!settings.isLoading && settings.data && !settings.data.enabled ? <Button secondary label="前往开启个人记忆" onPress={() => router.push('/personal-memory' as never)} /> : null}
    <Button label={refresh.isPending ? '正在整理…' : '从已核验结果整理建议'} disabled={!settings.data?.enabled || refresh.isPending} onPress={() => refresh.mutate()} />
    {refresh.isSuccess ? <Text style={ui.detail}>{refresh.data.created ? `新增 ${refresh.data.created} 条待核对建议。` : '没有新增可用建议。已忽略或失效的建议不会重新出现。'}</Text> : null}
    {refresh.isError ? <Text style={ui.error}>{memoryMutationError(refresh.error)}</Text> : null}
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? query.data.items.map(item =>
      <Pressable key={item.id} accessibilityRole="button" style={ui.card} onPress={() => router.push({ pathname: '/personal-memory/learning-review', params: { id: item.id } } as never)}>
        <Text style={ui.title}>{item.source?.scope ?? '操作结果建议'}</Text><Text style={ui.detail}>{learningStatusLabel(item.status)}</Text>
        {item.source ? <Text style={ui.detail}>{learningOutcomeLabel(item.source.outcome)} · 样本数 1</Text> : null}
      </Pressable>) : <EmptyState title="暂无经验建议" detail="开启记忆后，可从已有核验结果整理建议；报告完成不等于市场事实已核实。" />}
    {query.data?.nextCursor ? <Button secondary label="下一页" onPress={() => setCursor(query.data!.nextCursor!)} /> : null}
    {cursor ? <Button secondary label="返回最近建议" onPress={() => setCursor(undefined)} /> : null}
  </EditorPage>;
}
