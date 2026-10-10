import type { SkillRepositoryProjection } from '@lazy-armor/plan-schema';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { api } from './api';
import { Button, ui } from './editor-ui';
import { EmptyState, ErrorState, LoadingState } from './consumer-ui';
import { ConsumerPresentationMapper as p } from './consumer-presentation';

export function SkillRepositoryList({ token }: { token: string | undefined }) {
  const query = useInfiniteQuery({ queryKey: ['skill-repositories', token], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: SkillRepositoryProjection[]; nextCursor: string | null }>(`/skill-repositories?limit=10${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, token),
    getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(token) });
  if (!token) return <Button label="登录后查看方法仓库" onPress={() => router.push('/auth/login' as never)} />;
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  return <View style={{ gap: 8 }}><Text style={ui.detail}>方法用于理解和规划。具体资源、权限与执行仍由计划核对。</Text>
    {items.map(repo => <Pressable key={repo.id} onPress={() => router.push(`/skill-repositories/${repo.id}` as never)} style={ui.listRow} accessibilityRole="button">
      <Text style={ui.title}>{p.text(repo.name, '方法仓库')}</Text><Text style={ui.detail}>{repo.entries.length} 个方法 · {repo.enabled ? '已启用规划参考' : '规划参考已关闭'}</Text>
      <Text style={ui.detail}>{repo.sourceType === 'GITHUB' ? 'GitHub 来源' : repo.sourceType === 'COMMUNITY' ? '社区来源' : '我的方法'} · 用户导入</Text>
    </Pressable>)}
    {!items.length ? <EmptyState title="还没有接入方法" detail="选择方法包后查看来源与版本，再决定是否用于规划。" action="接入方法" onPress={() => router.push('/skill-import' as never)} /> : null}
    {query.hasNextPage ? <Button secondary label={query.isFetchingNextPage ? '加载中…' : '更多仓库'} disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /> : null}
  </View>;
}
