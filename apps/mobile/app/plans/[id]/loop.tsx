import type { AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { Button, Card, EditorPage, ui } from '../../../src/editor-ui';
import { EmptyState, ErrorState, LoadingState } from '../../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../../src/consumer-presentation';
import { executionStatusLabel } from '../../../src/execution-presenter';
const checkpointLabels: Record<string, string> = { WAITING_RESOURCE: '等待资源恢复', WAITING_FACT_CHANGE: '等待新的变化',
  WAITING_FACT_CONFIRMATION: '等待你核实线索', WAITING_NEXT_SCHEDULE: '等待下次检查', COMPLETED_RUN: '本次运行结束',
  OUTCOME_UNKNOWN: '结果需要核对', READ_PENDING: '读取中', READ_FAILED: '读取未完成', NEEDS_ATTENTION: '需要处理', INACTIVE_VERSION: '原版本已停止' };
type Page = { planVersionId: string | null; items: AgentLoopHistoryItem[]; nextCursor: string | null };
export default function LoopHistory() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(state => state.token);
  const query = useInfiniteQuery({ queryKey: ['agent-loop-history', token, id], initialPageParam: null as string | null, enabled: Boolean(token && id),
    queryFn: ({ pageParam }) => api<Page>(`/plans/${id}/agent-loop/history?limit=10${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, token),
    getNextPageParam: page => page.nextCursor ?? undefined });
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  return <EditorPage title="持续运行记录"><Text style={ui.detail}>原计划当前运行版本的执行与等待记录。运行结束后，结果是否核实可在计划的判断依据中查看。</Text>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : items.length ? items.map(item =>
      <Card key={item.id} title={item.kind === 'RUN' ? executionStatusLabel(item.state) : checkpointLabels[item.state] ?? '状态已记录'} detail={p.dateTime(item.recordedAt)}>
        <Text style={ui.detail}>{item.kind === 'RUN' ? '计划运行' : '持续关注'}{item.nextRunAt ? ` · 下次检查 ${p.dateTime(item.nextRunAt)}` : ''}</Text>
      </Card>) : <EmptyState title="暂无运行记录" detail="计划开始运行或进入等待后，这里会显示实际记录。" />}
    {query.hasNextPage ? <Button label={query.isFetchingNextPage ? '加载中…' : '更多记录'} disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /> : null}
  </EditorPage>;
}
