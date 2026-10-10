import type { AgentLoopCoverage, AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { Button, Card, EditorPage, ui } from '../../../src/editor-ui';
import { EmptyState, ErrorState, LoadingState } from '../../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../../src/consumer-presentation';
import { executionStatusLabel } from '../../../src/execution-presenter';
import { loopHistoryItems, loopRunHistoryTitle } from '../../../src/agent-loop-presenter';
const checkpointLabels: Record<string, string> = { WAITING_RESOURCE: '等待资源恢复', WAITING_FACT_CHANGE: '等待新的变化',
  WAITING_FACT_CONFIRMATION: '等待你核实线索', WAITING_NEXT_SCHEDULE: '等待下次检查', COMPLETED_RUN: '本次运行结束',
  OUTCOME_UNKNOWN: '结果需要核对', READ_PENDING: '读取中', READ_FAILED: '读取未完成', NEEDS_ATTENTION: '需要处理', INACTIVE_VERSION: '原版本已停止' };
type Page = { planVersionId: string | null; items: AgentLoopHistoryItem[]; nextCursor: string | null };
export default function LoopHistory() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(state => state.token);
  const coverage = useQuery({ queryKey: ['agent-loop-coverage', token, id], enabled: Boolean(token && id),
    queryFn: () => api<AgentLoopCoverage>(`/plans/${id}/agent-loop/coverage`, token) });
  const query = useInfiniteQuery({ queryKey: ['agent-loop-history', token, id, coverage.data?.planVersionId], initialPageParam: null as string | null, enabled: Boolean(token && id),
    queryFn: ({ pageParam }) => api<Page>(`/plans/${id}/agent-loop/history?limit=10${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, token),
    getNextPageParam: page => page.nextCursor ?? undefined });
  const items = loopHistoryItems(query.data?.pages ?? [], coverage.data?.planVersionId);
  const changedVersion = Boolean(coverage.data && query.data && query.data.pages[0]?.planVersionId !== coverage.data.planVersionId);
  return <EditorPage title="持续运行记录"><Text style={ui.detail}>当前运行版本的执行、等待和结果核实记录。核对后的结果与原运行状态分别保留。</Text>
    <Button secondary label="刷新记录" disabled={query.isFetching || coverage.isFetching} onPress={() => void Promise.all([query.refetch(), coverage.refetch()])} />
    {coverage.isLoading ? <LoadingState /> : coverage.isError ? <ErrorState onRetry={() => void coverage.refetch()} /> : coverage.data ? <Card title="最近七天的记录" detail="按北京时间统计，包含今天尚未结束的记录">
      <Text style={ui.detail}>有记录 {coverage.data.recordedDayCount}/7 天 · 有已核实运行 {coverage.data.verifiedDayCount}/7 天</Text>
      {coverage.data.days.map(day => <Text key={day.date} style={ui.detail}>{day.date}：运行 {day.runCount} 次 · 等待或状态 {day.checkpointCount} 次 · 已核实 {day.verifiedRunCount} 次{day.needsAttentionRunCount ? ` · 需要留意 ${day.needsAttentionRunCount} 次` : ''}</Text>)}
      {!coverage.data.recordsComplete ? <Text style={ui.detail}>记录较多，本次统计不完整。完整记录可继续向下查看。</Text> : null}
      <Text style={ui.detail}>没有记录不代表停机，等待变化时可能保持静默。这些记录不单独证明连续运行七天，真实连续验收仍需核对。</Text>
    </Card> : null}
    {changedVersion ? <Text style={ui.detail}>计划已更新，请刷新记录后查看。</Text> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : items.length ? items.map(item =>
      <Card key={item.id} title={item.kind === 'RUN' ? loopRunHistoryTitle(item) : checkpointLabels[item.state] ?? '状态已记录'} detail={p.dateTime(item.recordedAt)}>
        <Text style={ui.detail}>{item.kind === 'RUN' ? '计划运行' : '持续关注'}{item.nextRunAt ? ` · 下次检查 ${p.dateTime(item.nextRunAt)}` : ''}</Text>
        {item.reflection ? <Text style={ui.detail}>原运行记录：{executionStatusLabel(item.reflection.recordedStatus)}</Text> : null}
      </Card>) : <EmptyState title="暂无运行记录" detail="计划开始运行或进入等待后，这里会显示实际记录。" />}
    {query.hasNextPage && !changedVersion ? <Button label={query.isFetchingNextPage ? '加载中…' : '更多记录'} disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /> : null}
  </EditorPage>;
}
