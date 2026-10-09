import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Text } from 'react-native';
import type { ConnectionCapabilityView } from '@lazy-armor/plan-schema';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { ConnectionCapabilityPanel } from '../src/connection-capability-panel';

export default function InterfaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore(s => s.token), client = useQueryClient();
  const connection = useQuery({ queryKey: ['interface', token, id], queryFn: () => api<{ externalAccountName: string; status: string; lastCheckedAt: string | null }>(`/connections/${id}`, token), enabled: Boolean(token && id) });
  const permissions = useQuery({ queryKey: ['interface-permissions', token, id], queryFn: () => api<Array<{ capability: string; granted: boolean }>>(`/connections/${id}/permissions`, token), enabled: Boolean(token && id) });
  const capabilities = useQuery({ queryKey: ['connection-capabilities', token, id], queryFn: () => api<ConnectionCapabilityView>(`/connections/${id}/capabilities`, token), enabled: Boolean(token && id), refetchInterval: 30000 });
  const allowed = permissions.data?.find(item => item.capability === 'READ_PUBLIC_HTTP_JSON')?.granted === true;
  const usable = capabilities.isSuccess && !capabilities.isFetching && capabilities.data.capabilities.some(item => item.key === 'READ_PUBLIC_HTTP_JSON' && item.usable && !!item.evidence.validUntil && new Date(item.evidence.validUntil).getTime() > Date.now());
  const refresh = async () => { await Promise.all([connection.refetch(), permissions.refetch(), client.invalidateQueries({ queryKey: ['resources', token] }), client.invalidateQueries({ queryKey: ['resource-workspace', token] }), client.invalidateQueries({ queryKey: ['connection-capabilities', token, id] })]); };
  const grant = useMutation({ mutationFn: () => api(`/connections/${id}/permissions`, token, { method: 'PUT', body: JSON.stringify({ permissions: [{ capability: 'READ_PUBLIC_HTTP_JSON', granted: !allowed }] }) }), onMutate: () => read.reset(), onSuccess: refresh });
  const validate = useMutation({ mutationFn: () => api(`/connections/${id}/validate`, token, { method: 'POST' }), onMutate: () => read.reset(), onSuccess: refresh });
  const read = useMutation({ mutationFn: async (source: { id: string; token: string }) => ({ source, response: await api<{ value: unknown; retrievedAt: string; verification: string }>(`/connections/${source.id}/invoke`, source.token, { method: 'POST', body: JSON.stringify({ capability: 'READ_PUBLIC_HTTP_JSON', requestId: `read-${Date.now()}`, input: {} }) }) }) });
  const remove = useMutation({ mutationFn: () => api(`/connections/${id}`, token, { method: 'DELETE' }), onMutate: () => read.reset(), onSuccess: async () => { await refresh(); router.replace('/resources' as never); } });
  useEffect(() => { read.reset(); }, [token, id]);
  const preview = read.data?.source.id === id && read.data.source.token === token && usable && allowed && !grant.isPending && !validate.isPending && !remove.isPending ? read.data.response : null;
  const busy = grant.isPending || validate.isPending || read.isPending || remove.isPending;
  const error = connection.error ?? permissions.error ?? capabilities.error ?? grant.error ?? validate.error ?? read.error ?? remove.error;
  return <EditorPage title="接口详情">
    <Card title={connection.data?.externalAccountName ?? '公开 JSON 接口'}>
      <Text style={ui.detail}>状态：{({ connected: '已添加', degraded: '需要处理', reauthorization_required: '需要重新授权', revoked: '已断开', provider_error: '来源不可用', expired: '已过期', pending_authorization: '待授权' } as Record<string, string>)[connection.data?.status ?? ''] ?? '读取中'}</Text>
      <Text style={ui.detail}>最近检查：{connection.data?.lastCheckedAt ? new Date(connection.data.lastCheckedAt).toLocaleString() : '尚未检查'}</Text>
      <Text style={ui.detail}>读取权限：{permissions.isLoading ? '读取中' : allowed ? '已开启' : '未开启'}</Text>
      <Button secondary label="检查连接" disabled={busy} onPress={() => validate.mutate()} />
      <Button secondary label={allowed ? '关闭读取权限' : '开启读取权限'} disabled={busy || !permissions.data || connection.data?.status === 'revoked'} onPress={() => Alert.alert(allowed ? '关闭读取权限？' : '允许读取公开接口？', '授权后可以读取此接口返回的数据，数据内容仍需按具体场景验证。', [{ text: '取消' }, { text: '确认', onPress: () => grant.mutate() }])} />
      <Button label={read.isPending ? '读取中…' : '读取数据'} disabled={busy || !usable || !allowed || !token} onPress={() => { read.reset(); if (token) read.mutate({ id, token }); }} />
    </Card>
    <ConnectionCapabilityPanel id={id} token={token} />
    {preview ? <Card title="接口响应">
      <Text style={ui.detail}>{new Date(preview.retrievedAt).toLocaleString()} · 来源响应，尚未验证内容真实性</Text>
      <Text selectable style={ui.detail}>{JSON.stringify(preview.value, null, 2).slice(0, 8000)}</Text>
      {JSON.stringify(preview.value).length > 8000 ? <Text style={ui.detail}>预览仅显示前 8000 字符</Text> : null}
    </Card> : null}
    {error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}
    <Button secondary label="断开接口" disabled={busy || !connection.data || connection.data.status === 'revoked'} onPress={() => Alert.alert('断开接口？', '历史记录保留，后续无法继续读取。', [{ text: '取消' }, { text: '断开', style: 'destructive', onPress: () => remove.mutate() }])} />
  </EditorPage>;
}
