import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
type Status = { configured: boolean; implementation: string };
export default function BrowserResource() {
  const token = useAuthStore(state => state.token), client = useQueryClient();
  const [name, setName] = useState(''), [endpoint, setEndpoint] = useState('');
  const status = useQuery({ queryKey: ['browser-status', token], queryFn: () => api<Status>('/browser/status', token), enabled: Boolean(token) });
  const create = useMutation({ mutationFn: () => api<{ id: string }>('/connections', token, { method: 'POST',
    body: JSON.stringify({ connectorId: 'controlled_browser', externalAccountName: name.trim(), credentials: { endpoint: endpoint.trim() } }) }),
    onSuccess: async result => { await client.invalidateQueries({ queryKey: ['resources', token] }); router.replace(`/connections/${result.id}` as never); } });
  return <EditorPage title="受控网页">{!token ? <Button label="去登录" onPress={() => router.push('/auth/login' as never)} /> :
    status.isLoading ? <LoadingState /> : status.isError ? <ErrorState onRetry={() => void status.refetch()} /> : <>
      <Card title={status.data?.configured ? '网页能力已接入' : '网页能力尚未开放'}>
        <Text style={ui.detail}>仅使用已允许的网站与独立浏览器会话，不读取你的个人浏览器账号。页面读取需要单独授权，表单提交还需要逐次确认与结果核对。</Text>
        {!status.data?.configured ? <Text style={ui.detail}>当前服务还未接入可用的网页运行资源，已有计划会保留资源缺口。</Text> : null}
      </Card>
      {status.data?.configured ? <><Card title="添加网站资源"><Field label="名称" value={name} onChange={setName} max={120} />
        <Field label="网站地址" value={endpoint} onChange={setEndpoint} max={2000} /><Text style={ui.detail}>添加时检查网站是否在允许范围并可读取，之后可分别管理读取与表单权限。</Text>
      </Card><Button label={create.isPending ? '检查网站中…' : '添加网站'} disabled={create.isPending || !name.trim() || !endpoint.trim()} onPress={() => create.mutate()} />
        {create.isError ? <Text style={ui.error}>网站未能接入，请核对地址、允许范围与可用状态。</Text> : null}</> : null}
    </>}</EditorPage>;
}
