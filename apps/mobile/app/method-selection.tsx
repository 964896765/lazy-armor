import type { SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
import { addSelectedMethod, methodSelectionState, moveSelectedMethod, removeSelectedMethod, startMethodConversation, type SelectedMethod } from '../src/method-selection';
import { riskLevelLabel } from '../src/today-presenter';

export default function MethodSelectionPage() {
  const token = useAuthStore(s => s.token);
  return <MethodSelector key={token ?? 'signed-out'} token={token} />;
}

function MethodSelector({ token }: { token: string | undefined }) {
  const client = useQueryClient(), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [selected, setSelected] = useState<SelectedMethod[]>([]), [error, setError] = useState('');
  const catalogue = useInfiniteQuery({ queryKey: ['skill-repositories', token], enabled: Boolean(token), initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: SkillRepositoryProjection[]; nextCursor: string | null }>(`/skill-repositories?limit=10${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, token),
    getNextPageParam: page => page.nextCursor ?? undefined });
  const repositoryIds = [...new Set(selected.map(item => item.ref.repositoryId))];
  const checks = useQueries({ queries: repositoryIds.map(id => ({ queryKey: ['skill-repository', token, id], enabled: Boolean(token), staleTime: 0,
    queryFn: () => api<SkillRepositoryProjection>(`/skill-repositories/${id}`, token) })) });
  const refresh = useCallback(async () => {
    if (token) await Promise.all([client.invalidateQueries({ queryKey: ['skill-repositories', token] }), client.invalidateQueries({ queryKey: ['skill-repository', token] })]);
  }, [token, client]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const activeScope = () => mounted.current && useAuthStore.getState().token === token;
  const start = useMutation({ retry: false, mutationFn: (choices: SelectedMethod[]) => startMethodConversation(choices,
    id => api<SkillRepositoryProjection>(`/skill-repositories/${id}`, token), request => {
      if (!activeScope()) throw new Error('会话上下文已变化，请重新打开方法选择。');
      return api<{ id: string }>('/conversations', token, { method: 'POST', body: JSON.stringify(request) });
    }), onSuccess: async conversation => {
      if (!activeScope()) return;
      await client.invalidateQueries({ queryKey: ['conversations', token] });
      if (activeScope()) router.replace({ pathname: '/chat', params: { conversationId: conversation.id } } as never);
    }, onError: failure => { if (activeScope()) { setError(p.error(failure)); void refresh(); } } });
  const select = (repo: SkillRepositoryProjection, entryId: string) => {
    try { setSelected(addSelectedMethod(selected, repo, entryId)); setError(''); } catch (failure) { setError(p.error(failure)); }
  };
  const currentState = (choice: SelectedMethod) => {
    const query = checks[repositoryIds.indexOf(choice.ref.repositoryId)];
    return query?.isFetching || query?.isPending ? 'CHECKING' : query?.isError ? 'UNAVAILABLE' : methodSelectionState(choice.ref, query?.data);
  };
  const canStart = selected.length > 0 && selected.every(choice => currentState(choice) === 'CURRENT') && !start.isPending;
  const repositories = [...new Map((catalogue.data?.pages.flatMap(page => page.items) ?? []).map(repo => [repo.id, repo])).values()];
  return <EditorPage title="选择规划方法">
    {!token ? <Button label="登录后选择方法" onPress={() => router.push('/auth/login' as never)} /> : <>
      <Card title={`已选择 ${selected.length}/3 个方法`}>
        <Text style={ui.detail}>按你选择的顺序提供给 AI 作为规划参考。开始会话后再表达目标，选择一次处理或设为计划，并核对实际资源与权限。</Text>
        {selected.map((choice, index) => <Card key={choice.ref.entryId} title={`${index + 1}. ${p.text(choice.manifest.name)}`} detail={`${p.text(choice.repositoryName)} · ${choice.manifest.version}`}>
          <Text style={ui.detail}>{p.text(choice.manifest.description)}</Text>
          <Text style={ui.detail}>声明风险：{riskLevelLabel(choice.manifest.risk)}</Text>
          <Text style={ui.detail}>所需能力：{choice.manifest.requiredCapabilities.map(key => p.capability(key)).join('、') || '未声明外部能力'}</Text>
          <Text style={ui.detail}>{({ CURRENT: '当前版本可用于规划参考', CHECKING: '正在核对当前版本', CHANGED: '方法或仓库已更新，请移除后重新选择', UNAVAILABLE: '方法已关闭、移出或暂时无法核对，请查看仓库或重新核对' })[currentState(choice)]}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ flex: 1 }}><Button secondary label="上移" disabled={start.isPending || index === 0} onPress={() => setSelected(moveSelectedMethod(selected, choice.ref.entryId, -1))} /></View>
            <View style={{ flex: 1 }}><Button secondary label="下移" disabled={start.isPending || index === selected.length - 1} onPress={() => setSelected(moveSelectedMethod(selected, choice.ref.entryId, 1))} /></View>
            <View style={{ flex: 1 }}><Button secondary label="移除" disabled={start.isPending} onPress={() => { setSelected(removeSelectedMethod(selected, choice.ref.entryId)); setError(''); }} /></View>
          </View>
          <Button secondary label="查看方法仓库" disabled={start.isPending} onPress={() => router.push(`/skill-repositories/${choice.ref.repositoryId}` as never)} />
        </Card>)}
        {!selected.length ? <Text style={ui.detail}>从下方本人仓库中选择一至三个已启用的方法。</Text> : null}
        <Button label={start.isPending ? '核对并创建会话中…' : '用所选方法开始会话'} disabled={!canStart} onPress={() => { setError(''); start.mutate(selected); }} />
        <Button secondary label="重新核对方法" disabled={start.isPending || catalogue.isFetching || checks.some(query => query.isFetching)} onPress={() => void refresh()} />
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </Card>
      {catalogue.isLoading ? <LoadingState /> : null}
      {repositories.map(repo => <Card key={repo.id} title={p.text(repo.name)} detail={repo.enabled ? '规划参考已启用' : '规划参考已关闭'}>
        {repo.entries.map(entry => <Card key={entry.id} title={p.text(entry.manifest.name)} detail={`版本 ${entry.manifest.version}`}>
          <Text style={ui.detail}>{p.text(entry.manifest.description)}</Text>
          <Button secondary label={selected.some(choice => choice.ref.entryId === entry.id) ? '已选择' : '选择此方法'}
            disabled={start.isPending || catalogue.isFetching || !repo.enabled || repo.status !== 'ACTIVE' || selected.length >= 3 || selected.some(choice => choice.ref.entryId === entry.id)}
            onPress={() => select(repo, entry.id)} />
        </Card>)}
        <Button secondary label={repo.enabled ? '查看方法仓库' : '查看仓库并启用'} disabled={start.isPending} onPress={() => router.push(`/skill-repositories/${repo.id}` as never)} />
      </Card>)}
      {catalogue.isError ? <><Text style={ui.error}>仓库读取失败，请重新核对。</Text><Button secondary label="重新读取仓库" disabled={start.isPending} onPress={() => void catalogue.refetch()} /></> : null}
      {catalogue.isSuccess && !repositories.length ? <><Text style={ui.detail}>还没有接入方法仓库。</Text><Button secondary label="接入方法仓库" onPress={() => router.push('/skill-import' as never)} /></> : null}
      {catalogue.hasNextPage ? <Button secondary label={catalogue.isFetchingNextPage ? '加载中…' : '更多方法仓库'} disabled={start.isPending || catalogue.isFetching} onPress={() => void catalogue.fetchNextPage()} /> : null}
    </>}
  </EditorPage>;
}
