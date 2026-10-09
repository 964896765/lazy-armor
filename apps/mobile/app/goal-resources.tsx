import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Text } from 'react-native';
import type { GoalResourceMatch } from '@lazy-armor/plan-schema';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';

export default function GoalResourcesPage() {
  const { conversationId, messageId, version } = useLocalSearchParams<{ conversationId: string; messageId: string; version: string }>();
  const token = useAuthStore(state => state.token);
  const valid = /^[0-9a-f-]{36}$/i.test(conversationId ?? '') && /^[0-9a-f-]{36}$/i.test(messageId ?? '') && /^\d+$/.test(version ?? '');
  const query = useQuery({ queryKey: ['goal-resources', token, conversationId, messageId, version], enabled: Boolean(token && valid), staleTime: 0,
    queryFn: () => api<GoalResourceMatch>(`/conversations/${conversationId}/messages/${messageId}/resources?version=${version}`, token) });
  useFocusEffect(useCallback(() => { if (token && valid) void query.refetch(); }, [token, valid, query.refetch]));
  const backToGoal = () => router.replace({ pathname: '/chat', params: { conversationId } } as never);
  return <EditorPage title="目标所需资源">
    {!valid ? <Text style={ui.error}>请从会话中的目标理解卡片打开。</Text> : query.isFetching ? <LoadingState /> : query.isError ? <>
      <Text style={ui.error}>{presentation.error(query.error)}</Text>
      <Button secondary label="重新核对" onPress={() => void query.refetch()} />
    </> : query.data ? <>
      <Card title={presentation.text(query.data.summary, '当前目标')}><Text style={ui.detail}>核对当前资源是否就绪。补充资源后回到这里重新核对，再回原会话确认方案。</Text>
        <Text style={ui.detail}>最近核对：{presentation.dateTime(query.data.evaluatedAt)}</Text></Card>
      {query.data.requirements.map((need, index) => <Card key={index} title={presentation.capability(need.key)}>
        {need.reasons.map((reason, i) => <Text key={i} style={ui.detail}>{presentation.reason(reason)}</Text>)}
        {need.resources.map(resource => <Card key={resource.resourceId} title={presentation.text(resource.name, '所需资源')}>
          <Text style={ui.detail}>{({ READY: '资源已就绪', UNAVAILABLE: '需要补充或恢复', NEEDS_SELECTION: '需要选择来源' })[resource.state]}</Text>
          {resource.reasons.map((reason, i) => <Text key={i} style={ui.detail}>{presentation.reason(reason)}</Text>)}
          <Button secondary label={resource.action.label} onPress={() => router.push(resource.action.path as never)} />
        </Card>)}
        {!need.resources.length ? <Button secondary label="查看资源" onPress={() => router.push({ pathname: '/resources', params: { returnConversationId: conversationId } } as never)} /> : null}
      </Card>)}
      <Button secondary label="重新核对" onPress={() => void query.refetch()} />
    </> : null}
    {valid ? <Button secondary label="返回原会话" onPress={backToGoal} /> : null}
  </EditorPage>;
}
