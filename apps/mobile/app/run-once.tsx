import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
interface Option { planId: string; planVersionId: string; name: string; description: string | null }
export default function RunOnce() {
 const params = useLocalSearchParams<{ conversationId?: string; planId?: string }>(); const token = useAuthStore(s => s.token);
 const [conversationId, setConversationId] = useState(params.conversationId); const [selected, setSelected] = useState<Option | null>(null);
 const [requestId, setRequestId] = useState(() => `once-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const options = useQuery({ queryKey: ['once-options', token], queryFn: () => api<Option[]>('/consumer/run-once-options', token), enabled: Boolean(token) });
 useEffect(() => { const option = options.data?.find(item=>item.planId===params.planId); if(option)setSelected(option); }, [options.data,params.planId]);
 const run = useMutation({ mutationFn: async () => {
  if (!selected) throw new Error('请先选择一个计划'); let currentId = conversationId;
  if (!currentId) { const created = await api<{ id: string }>('/conversations', token, { method: 'POST', body: JSON.stringify({ mode: 'TEMPORARY', title: '一次性运行' }) }); currentId = created.id; setConversationId(currentId); }
  return api<{ id: string; executionId: string | null; status: string }>(`/conversations/${currentId}/run-once`, token, { method: 'POST', body: JSON.stringify({ planId: selected.planId, planVersionId: selected.planVersionId, requestId, triggerPayload: {}, confirmed: true }) });
 }, onSuccess: result => router.replace(`/once-request?id=${result.id}` as never) });
 return <EditorPage title="运行一次">{!token ? <Button label="登录后运行" onPress={() => router.push('/auth/login' as never)} /> : <><Card title="选择已有计划"><Text style={ui.detail}>按计划已连接的数据运行一次，不改变持续运行设置。能力、权限和风险会重新检查，涉及审批时仍需确认。</Text>{options.data?.map(item => <Button key={item.planId} secondary label={`${selected?.planId === item.planId ? '已选择 · ' : ''}${item.name}`} disabled={run.isPending} onPress={() => { if (selected?.planId !== item.planId) setRequestId(`once-${Date.now()}-${Math.random().toString(36).slice(2)}`); setSelected(item); }} />)}{options.data?.length === 0 ? <Text style={ui.detail}>暂无已启用的计划。先在计划会话中创建并启用计划。</Text> : null}{options.isError ? <Button secondary label="读取失败，重试" onPress={() => void options.refetch()} /> : null}</Card>{selected ? <Card title={selected.name}><Text style={ui.detail}>{selected.description || '按当前计划版本执行'}</Text></Card> : null}{run.error ? <Text style={ui.error}>{presentation.error(run.error)}</Text> : null}<Button label={run.isPending ? '提交中…' : '确认本次运行'} disabled={!selected || run.isPending} onPress={() => Alert.alert('运行一次？', `${selected?.name}。本次确认不会代替后续风险审批。`, [{ text: '取消' }, { text: '确认', onPress: () => run.mutate() }])} /></>}</EditorPage>;
}
