import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authoringJobTerminal, reportTerminal } from '@lazy-armor/plan-schema/mobile';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
import { parseGoalExperience } from '../src/goal-experience-presenter';
import { GoalBriefCard } from '../src/goal-brief-card';
import { workspaceConversation } from '../src/workspace-presenter';

/** Consumer workspace on the existing Web build; Admin operations remain independent. */
export default function WorkspacePage() {
  const token = useAuthStore(state => state.token), { width } = useWindowDimensions(), wide = width >= 1100;
  const [selectedId, setSelectedId] = useState<string>();
  const goals = useQuery({ queryKey: ['workspace-goals', token], enabled: Boolean(token), queryFn: async () => {
    const value = parseGoalExperience(await api<unknown>('/consumer/goal-experience?limit=20', token));
    if (!value) throw new Error('目标状态暂不可读取'); return value;
  }, refetchInterval: query => query.state.data?.items.some(goal => goal.authoringJob && !authoringJobTerminal(goal.authoringJob.status) || goal.report && !reportTerminal(goal.report.stage)) ? 5000 : 20000 });
  const selected = goals.isError ? undefined : goals.data?.items.find(goal => goal.conversationId === selectedId) ?? goals.data?.items[0];
  return <SafeAreaView style={{ flex: 1 }}><Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.brand}>懒人装甲 · 个人工作台</Text><Text style={ui.detail}>目标、条件、成果与下一步</Text></View>
      <Button secondary label="返回今天" onPress={() => router.push('/' as never)} /><Button label="创建目标" onPress={() => router.push({ pathname: '/chat', params: { mode: 'temporary', newGoal: String(Date.now()) } } as never)} /></View>
    <ScrollView contentContainerStyle={[styles.layout, { flexDirection: wide ? 'row' : 'column' }]}>
      <View style={[styles.column, wide && { width: 240 }]}>
        <Card title="我的目标"><Button secondary label="计划" onPress={() => router.push('/plans' as never)} /><Button secondary label="资源" onPress={() => router.push('/resources' as never)} />
          <Button secondary label="能力中心" onPress={() => router.push('/method-selection' as never)} /><Button secondary label="个人信息与经验" onPress={() => router.push('/personal-memory' as never)} /></Card>
        {goals.isLoading ? <LoadingState /> : goals.isError ? <ErrorState onRetry={() => void goals.refetch()} detail={p.error(goals.error)} /> : goals.data?.items.map(goal => <Pressable key={goal.conversationId} accessibilityRole="button" accessibilityState={{ selected: selected?.conversationId === goal.conversationId }}
          onPress={() => setSelectedId(goal.conversationId)} style={[styles.goal, selected?.conversationId === goal.conversationId && styles.selected]}><Text style={ui.title}>{goal.title}</Text><Text style={ui.detail}>{goal.status}</Text></Pressable>)}
        {goals.data?.truncated ? <Button secondary label="查看更多目标" onPress={() => router.push('/chat' as never)} /> : null}
        {goals.data?.unavailableConversationIds.length ? <Text style={ui.detail}>部分目标暂不可读取，刷新后继续核对。</Text> : null}
        <Button secondary label="刷新目标" disabled={goals.isFetching} onPress={() => void goals.refetch()} />
      </View>
      <View style={[styles.column, wide && { flex: 1 }]}>
        {selected && token ? <WorkspaceGoal key={`${token}:${selected.conversationId}`} token={token} conversationId={selected.conversationId} title={selected.title} />
          : !goals.isLoading && !goals.isError ? <Card title="开始一个目标"><Text style={ui.detail}>描述你想完成的事情，目标条件、方案与结果会保存在同一个空间。</Text></Card> : null}
      </View>
      <View style={[styles.column, wide && { width: 260 }]}>
        {selected ? <Card title="下一步"><Text style={ui.label}>{selected.status}</Text><Text style={ui.detail}>{selected.nextStep}</Text>
          <Button label={selected.primaryAction.label} onPress={() => router.push(selected.primaryAction.path as never)} />
          {selected.planId ? <Button secondary label="查看目标计划" onPress={() => router.push(`/plans/${selected.planId}` as never)} /> : null}
          <Text style={ui.detail}>最近核对：{p.dateTime(selected.evaluatedAt)}</Text></Card> : null}
        <Card title="成果与核实"><Text style={ui.detail}>报告交付、个人选择与实际结果分别记录。查看来源与测算假设后，再决定下一步。</Text></Card>
        {Platform.OS === 'web' ? <Text style={ui.detail}>当前浏览器登录用于本次会话，刷新页面后需要重新登录。</Text> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
function WorkspaceGoal({ token, conversationId, title }: { token: string; conversationId: string; title: string }) {
  const [reportId, setReportId] = useState<string>();
  const query = useQuery({ queryKey: ['workspace-conversation', token, conversationId], queryFn: async () => {
    const value = workspaceConversation(await api<unknown>(`/conversations/${conversationId}`, token), conversationId);
    if (!value) throw new Error('原目标内容暂不可读取'); return value;
  }, refetchInterval: query => query.state.data?.reports.some(item => !reportTerminal(item.report.stage)) ? 5000 : 20000 });
  const data = query.isError ? undefined : query.data, selected = data?.reports.find(item => item.messageId === reportId) ?? data?.reports[0];
  return <>
    <Card title={title}><Button secondary label="继续讨论与方案审阅" onPress={() => router.push({ pathname: '/chat', params: { conversationId } } as never)} /></Card>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState detail={p.error(query.error)} onRetry={() => void query.refetch()} /> : data ? <>
      <Card title="目标条件"><GoalBriefCard value={data.goal} /></Card>
      {data.answer ? <Card title="最近答复"><Text selectable style={styles.body}>{data.answer}</Text></Card> : null}
      {data.unavailableReports ? <Text style={ui.error}>部分报告格式暂不可读取，请回原目标核对。</Text> : null}
      {data.reports.length ? <Card title="报告与历史版本">{data.reports.map(item => <Button key={item.messageId} secondary label={`${item.messageId === selected?.messageId ? '已选：' : ''}${item.report.plan?.title ?? '报告'} · ${item.status}`}
        onPress={() => setReportId(item.messageId)} />)}</Card> : null}
      {selected ? <><Card title={selected.report.plan?.title ?? '报告'}><Text style={ui.label}>{selected.status}</Text>
        <Text style={ui.detail}>交付时间：{p.dateTime(selected.report.updatedAt)}</Text>
        {selected.report.warnings.map((warning, index) => <Text key={index} style={ui.detail}>{warning}</Text>)}
        {selected.report.markdown ? <Text selectable style={styles.body}>{selected.report.markdown}</Text> : <Text style={ui.detail}>正文尚未生成。</Text>}
        <Button secondary label="查看提示词、来源与决定" onPress={() => router.push({ pathname: '/report', params: { conversationId, messageId: selected.messageId } } as never)} />
      </Card>{selected.report.plan?.assumptions.length ? <Card title="本次测算假设">{selected.report.plan.assumptions.map((item, index) => <Text key={index} style={ui.detail}>{item}</Text>)}</Card> : null}</> : null}
    </> : null}
    <Button secondary label="刷新目标内容" disabled={query.isFetching} onPress={() => void query.refetch()} />
  </>;
}
const styles = StyleSheet.create({ header: { flexDirection: 'row', gap: 12, padding: 20, alignItems: 'center', flexWrap: 'wrap' }, brand: { color: '#172033', fontSize: 22, fontWeight: '700' },
  layout: { padding: 16, gap: 20, alignItems: 'stretch', width: '100%', maxWidth: 1680, alignSelf: 'center' }, column: { gap: 10, minWidth: 0 },
  goal: { padding: 12, gap: 5, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.5)', borderWidth: 1, borderColor: 'transparent' }, selected: { borderColor: '#3083FF', backgroundColor: 'rgba(234,242,255,0.7)' },
  body: { color: '#27364B', fontSize: 15, lineHeight: 26 },
});
