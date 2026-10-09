import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import type { ConnectionCapabilityView } from '@lazy-armor/plan-schema';
import { api } from './api';
import { Card, ui } from './editor-ui';
import { ErrorState, LoadingState } from './consumer-ui';
import { ConsumerPresentationMapper as presentation } from './consumer-presentation';
import { capabilityPermission, capabilitySources, capabilityStatus } from './connection-capability-presenter';

export function ConnectionCapabilityPanel({ id, token }: { id: string; token: string | undefined }) {
  const query = useQuery({ queryKey: ['connection-capabilities', token, id], enabled: Boolean(token && id),
    queryFn: () => api<ConnectionCapabilityView>(`/connections/${id}/capabilities`, token), refetchInterval: 30000 });
  return <Card title="可用能力">{query.isLoading ? <LoadingState/> : query.isError ? <ErrorState onRetry={() => void query.refetch()}/> :
    !query.data?.capabilities.length ? <Text style={ui.detail}>此资源尚未接入可调用能力。</Text> : <>
      <Text style={ui.detail}>已连接的资源仍按每项能力检查授权与可用状态。</Text>
      {query.data.capabilities.map(capability => <View key={capability.key} style={ui.listRow}>
        <View style={ui.line}><Text style={[ui.label, { flex: 1 }]}>{presentation.text(capability.name, '资源能力')}</Text><Text style={ui.detail}>{capabilityStatus(capability)}</Text></View>
        <Text style={ui.detail}>{capability.operation === 'read' ? '信息读取' : capability.operation === 'subscribe' ? '消息订阅' : '执行操作'} · {capabilitySources(capability.sourceModes)}</Text>
        <Text style={ui.detail}>授权：{capabilityPermission(capability.grant)}</Text>
        <Text style={ui.detail}>最近检查：{capability.evidence.checkedAt ? presentation.dateTime(capability.evidence.checkedAt) : '尚未检查'}</Text>
        {capability.operation === 'execute' ? <Text style={ui.detail}>执行前按任务单独确认。</Text> : null}
      </View>)}
    </>}</Card>;
}
