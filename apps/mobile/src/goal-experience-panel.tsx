import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { authoringJobTerminal, reportTerminal, type WorkItemProjection } from '@lazy-armor/plan-schema/mobile';
import { api } from './api';
import { Button, ui } from './editor-ui';
import { actionableWorkItems, parseGoalExperience } from './goal-experience-presenter';

export function GoalExperiencePanel({ token, group }: { token: string | undefined; group: string }) {
  const goals = useQuery({ queryKey: ['goal-experience', token], enabled: Boolean(token), queryFn: async () => {
    const value = parseGoalExperience(await api<unknown>('/consumer/goal-experience?limit=10', token));
    if (!value) throw new Error('目标状态暂不可用');
    return value;
  }, refetchInterval: query => query.state.data?.items.some(goal => goal.authoringJob && !authoringJobTerminal(goal.authoringJob.status) || goal.report && !reportTerminal(goal.report.stage)) ? 5000 : 20000 });
  const work = useQuery({ queryKey: ['experience-work-items', token], enabled: Boolean(token && group === 'INCOMPLETE'), queryFn: () => api<{ items: WorkItemProjection[]; truncated: boolean; projectionFailures: unknown[] }>('/consumer/work-items', token), refetchInterval: 15000 });
  if (!token) return null;
  const items = goals.data?.items.filter(goal => goal.statusGroup === group) ?? [];
  const attention = actionableWorkItems(work.isError ? [] : work.data?.items ?? []);
  return <View style={{ gap: 8, paddingTop: 12 }}>
    <View style={ui.line}><Text style={[ui.title, { flex: 1 }]}>{group === 'COMPLETED' ? '最近成果' : '我的目标'}</Text><Button secondary label="创建目标" onPress={() => router.push({ pathname: '/chat', params: { mode: 'temporary', newGoal: String(Date.now()) } } as never)} /></View>
    {goals.isError ? <Button secondary label="目标读取失败，重试" onPress={() => void goals.refetch()} /> : items.map(goal => <Pressable key={goal.conversationId} accessibilityRole="button" style={ui.listRow} onPress={() => router.push(goal.primaryAction.path as never)}>
      <Text style={ui.title}>{goal.title}</Text><Text style={ui.label}>{goal.status}</Text><Text style={ui.detail}>{goal.nextStep}</Text><Text style={ui.detail}>{goal.primaryAction.label} ›</Text>
    </Pressable>)}
    {!goals.isLoading && !goals.isError && !items.length ? <Text style={ui.detail}>{group === 'COMPLETED' ? '完成后的报告和答复会保存在这里。' : '描述你想完成的事情，条件、方案与结果会保存在原目标中。'}</Text> : null}
    {goals.data?.truncated ? <Button secondary label="查看更多目标" onPress={() => router.push('/chat' as never)} /> : null}
    {goals.data?.unavailableConversationIds.length ? <Text style={ui.detail}>部分目标暂未读到，刷新后继续核对。</Text> : null}
    {group === 'INCOMPLETE' && work.isError ? <Button secondary label="下一步读取失败，重试" onPress={() => void work.refetch()} /> : null}
    {group === 'INCOMPLETE' && attention.length ? <><Text style={ui.title}>目标下一步</Text>{attention.map(item => <Pressable key={item.id} accessibilityRole="button" style={ui.listRow} onPress={() => router.push(item.primaryAction.path as never)}><Text style={ui.label}>{item.title}</Text><Text style={ui.detail}>{item.assessment?.reason ?? item.nextActionLabel}</Text><Text style={ui.detail}>{item.nextActionLabel} ›</Text></Pressable>)}</> : null}
    {group === 'INCOMPLETE' && work.data?.projectionFailures.length ? <Text style={ui.detail}>部分下一步尚未核对，原记录仍保留。</Text> : null}
  </View>;
}
