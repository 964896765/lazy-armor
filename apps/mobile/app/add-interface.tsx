import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';

export default function AddInterface() {
  const token = useAuthStore(s => s.token); const client = useQueryClient();
  const [name, setName] = useState(''); const [endpoint, setEndpoint] = useState(''); const [error, setError] = useState('');
  const add = useMutation({ mutationFn: () => api<{ id: string }>('/connections', token, { method: 'POST', body: JSON.stringify({ connectorId: 'public_http_json', externalAccountName: name.trim(), credentials: { endpoint: endpoint.trim() } }) }), onSuccess: async data => { await client.invalidateQueries({ queryKey: ['resources', token] }); await client.invalidateQueries({ queryKey: ['connections', token] }); router.replace(`/interface-detail?id=${data.id}` as never); }, onError: e => setError(e.message) });
  return <EditorPage title="添加接口">{!token ? <Button label="登录后添加" onPress={() => router.push('/auth/login' as never)} /> : <><Card title="公开 JSON 接口"><Field label="名称" value={name} onChange={setName} max={160} /><Field label="HTTPS 数据地址" value={endpoint} onChange={setEndpoint} max={2000} placeholder="https://example.com/data.json" /><Text style={ui.detail}>支持无需密钥、无查询参数的公开 JSON 地址，最多读取 128 KB。添加时会验证数据响应；之后需单独开启读取权限。</Text><Text style={ui.detail}>需要账号、API Key 或 MCP 工具的接口，需先完成正式适配与能力绑定。</Text></Card>{error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}<Button label={add.isPending ? '添加中…' : '确认添加'} disabled={add.isPending || !name.trim() || !endpoint.trim()} onPress={() => add.mutate()} /></>}</EditorPage>;
}
