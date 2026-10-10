import type { AgentLoopProjection, AgentLoopState } from '@lazy-armor/plan-schema';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { api } from './api';
import { ui } from './editor-ui';
import { ConsumerPresentationMapper as p } from './consumer-presentation';
import { loopReflectionLabel } from './agent-loop-presenter';

export const loopLabels: Record<AgentLoopState, string> = {
  DRAFT: '等待启用', PAUSED: '已暂停', ENDED: '已结束', WAITING_RESOURCE: '等待资源恢复',
  WAITING_CONFIRMATION: '需要你确认', OBSERVING: '正在观察', ACTING: '正在运行', VERIFYING: '等待结果核实',
  RECONCILING: '正在核对未知结果', WAITING: '等待下次检查', NEEDS_ATTENTION: '需要留意',
};
export function AgentLoopCards({ token }: { token: string | undefined }) {
  const query = useQuery({ queryKey: ['agent-loops', token], queryFn: () => api<{ items: AgentLoopProjection[]; nextCursor: string | null }>('/agent/loops?limit=5', token),
    enabled: Boolean(token), refetchInterval: 20000 });
  if (!token) return null;
  if (query.isError) return <Pressable onPress={() => void query.refetch()} style={ui.listRow}><Text style={ui.detail}>暂时无法读取持续关注，点击重试</Text></Pressable>;
  if (!query.data?.items.length) return null;
  return <View style={{ gap: 6 }}><Text style={ui.title}>AI 正在关注</Text>{query.data.items.map(loop => <Pressable key={loop.planId} style={ui.listRow}
    onPress={() => router.push(`/plans/${loop.planId}` as never)} accessibilityRole="button">
    <Text style={ui.title}>{p.text(loop.title, '持续计划')}</Text><Text style={ui.detail}>{loopLabels[loop.state]}</Text>
    {loop.nextRunAt ? <Text style={ui.detail}>下次检查 {p.dateTime(loop.nextRunAt)}</Text> : null}
    {loop.reflection ? <Text style={ui.detail}>上次{loopReflectionLabel(loop.reflection.outcome)}</Text> : null}
  </Pressable>)}{query.data.nextCursor ? <Pressable onPress={() => router.push('/plans' as never)}><Text style={ui.detail}>查看全部关注计划 ›</Text></Pressable> : null}</View>;
}
