import type { MethodResourceMatch } from '@lazy-armor/plan-schema/mobile';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
import { ResourceRequirements } from '../src/resource-requirements';
import { riskLevelLabel } from '../src/today-presenter';

export default function MethodResourcesPage() {
  const { conversationId, version } = useLocalSearchParams<{ conversationId: string; version: string }>();
  const token = useAuthStore(state => state.token);
  const valid = /^[0-9a-f-]{36}$/i.test(conversationId ?? '') && /^\d+$/.test(version ?? '');
  const query = useQuery({ queryKey: ['method-resources', token, conversationId, version], enabled: Boolean(token && valid), staleTime: 0,
    queryFn: () => api<MethodResourceMatch>(`/conversations/${conversationId}/method-resources?version=${version}`, token) });
  useFocusEffect(useCallback(() => { if (token && valid) void query.refetch(); }, [token, valid, query.refetch]));
  return <EditorPage title="方法所需资源">
    {!token ? <Button label="登录后核对资源" onPress={() => router.push('/auth/login' as never)} /> : !valid ? <Text style={ui.error}>请从原会话的方法卡片打开。</Text>
      : query.isFetching ? <LoadingState /> : query.isError ? <><Text style={ui.error}>{p.error(query.error)}</Text>
        <Button secondary label="重新核对" onPress={() => void query.refetch()} /></> : query.data ? <>
        <Card title="核对当前资源"><Text style={ui.detail}>这里按你选择的方法声明核对资源。具体目标仍需在原会话中表达，再核对实际范围、权限与方案。</Text>
          <Text style={ui.detail}>补充资源后重新核对；资源就绪后，实际操作继续按原政策确认与审批。</Text>
          <Text style={ui.detail}>最近核对：{p.dateTime(query.data.evaluatedAt)}</Text></Card>
        {query.data.methods.map(method => <Card key={method.ref.revisionId} title={p.text(method.name)} detail={`${p.text(method.repositoryName)} · ${method.version}`}>
          <Text style={ui.detail}>方法声明风险：{riskLevelLabel(method.declaredRisk)}</Text>
          {method.requirements.length ? <ResourceRequirements requirements={method.requirements} conversationId={conversationId} workContext={query.data!.workContext} />
            : <Text style={ui.detail}>这个方法未声明外部能力；实际目标是否需要资源仍由后续核对决定。</Text>}
        </Card>)}<Button secondary label="重新核对" onPress={() => void query.refetch()} />
      </> : null}
    {valid ? <Button secondary label="返回原会话" onPress={() => router.replace({ pathname: '/chat', params: { conversationId } } as never)} /> : null}
  </EditorPage>;
}
