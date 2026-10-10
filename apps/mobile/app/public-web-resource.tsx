import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
import { ConnectionCapabilityPanel } from '../src/connection-capability-panel';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
const CAPABILITY = 'READ_PUBLIC_WEB_RESEARCH';
export default function PublicWebResource() {
  const params = useLocalSearchParams<{ id?: string; entryUrls?: string }>();
  const token = useAuthStore(s => s.token), client = useQueryClient();
  const [name, setName] = useState(params.entryUrls?.startsWith('https://github.com/') ? 'GitHub 公开日榜' : '公开网页检索'), [entries, setEntries] = useState(params.entryUrls ?? '');
  const scope = useQuery({ queryKey: ['public-web-scope', token, params.id], enabled: Boolean(token && params.id), queryFn: () => api<{ entries: string[]; origins: string[] }>(`/connections/${params.id}/public-web-scope`, token) });
  const permissions = useQuery({ queryKey: ['public-web-permissions', token, params.id], enabled: Boolean(token && params.id), queryFn: () => api<Array<{ capability: string; granted: boolean }>>(`/connections/${params.id}/permissions`, token) });
  const allowed = permissions.data?.find(p => p.capability === CAPABILITY)?.granted === true;
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['resources', token] }), client.invalidateQueries({ queryKey: ['resource-workspace', token] }), scope.refetch(), permissions.refetch(), client.invalidateQueries({ queryKey: ['connection-capabilities', token, params.id] })]); };
  const create = useMutation({ mutationFn: () => api<{ id: string }>('/connections', token, { method: 'POST', body: JSON.stringify({ connectorId: 'public_web_research', externalAccountName: name.trim(), credentials: { entryUrls: entries.trim() } }) }),
    onSuccess: async row => { await client.invalidateQueries({ queryKey: ['resource-workspace', token] }); router.replace({ pathname: '/public-web-resource', params: { id: row.id } } as never); } });
  const grant = useMutation({ mutationFn: () => api(`/connections/${params.id}/permissions`, token, { method: 'PUT', body: JSON.stringify({ permissions: [{ capability: CAPABILITY, granted: !allowed }] }) }), onSuccess: refresh });
  const check = useMutation({ mutationFn: () => api(`/connections/${params.id}/validate`, token, { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/connections/${params.id}`, token, { method: 'DELETE' }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['resource-workspace', token] }); router.replace('/resources' as never); } });
  const busy = create.isPending || grant.isPending || check.isPending || remove.isPending;
  const error = scope.error ?? permissions.error ?? create.error ?? grant.error ?? check.error ?? remove.error;
  return <EditorPage title="公开网页检索">
    {!token ? <Button label="登录后配置" onPress={() => router.push('/auth/login' as never)} /> : params.id ? <>
      <Card title="确认的网站范围">{scope.data?.entries.map(url => <Text selectable key={url} style={ui.detail}>{url}</Text>)}
        <Text style={ui.detail}>只读取以上入口及其同一网站的公开网页。报告自动提出搜索词，通过必应搜索，再从范围内候选读取原文；无搜索结果时可从入口查找网页，会标明获取方式。</Text>
        {scope.data?.origins.includes('https://github.com') ? <Text style={ui.detail}>GitHub 每日汇总直接读取公开 Trending 日榜，所有语言前 10，不发送搜索词至必应。由 AI 生成提示词和中文摘要；启动计划后每天运行。</Text> : null}
        <Text style={ui.detail}>不会登录网站、填写表单或提交操作。网页内容与测算假设仍需独立核实。</Text>
        <Text style={ui.detail}>读取权限：{permissions.isLoading ? '读取中' : permissions.isError ? '暂时无法读取授权状态' : allowed ? '已开启' : '未开启'}</Text>
        <Button label={allowed ? '关闭网页检索权限' : '开启网页检索权限'} disabled={busy || !scope.data || !permissions.data} onPress={() => Alert.alert(allowed ? '关闭网页检索？' : '允许检索公开网页？', '开启后，报告会将自动形成的搜索词发送至必应，并读取上述网站范围内的公开正文。历史报告保留；关闭后新的读取与发布检查会停止。', [{ text: '取消' }, { text: '确认', onPress: () => grant.mutate() }])} />
        <Button secondary label={check.isPending ? '检查中…' : '检查连接'} disabled={busy} onPress={() => check.mutate()} />
      </Card><ConnectionCapabilityPanel id={params.id} token={token} />
      {scope.data?.origins.includes('https://github.com') ? <Button secondary label="准备 GitHub 每日汇总计划" onPress={() => router.push({ pathname: '/github-digest', params: { connectionId: params.id } } as never)} /> : null}
      <Button secondary label="断开网页检索资源" disabled={busy} onPress={() => Alert.alert('断开资源？', '历史报告保留，后续停止读取该范围。', [{ text: '取消' }, { text: '断开', onPress: () => remove.mutate() }])} />
    </> : <><Card title="添加公开网站范围"><Field label="名称" value={name} onChange={setName} max={160} />
      <Field label="HTTPS 网站入口，每行一个" value={entries} onChange={setEntries} max={6000} multiline />
      <Text style={ui.detail}>最多三个公开网页入口。读取范围为所填地址的同一网站，不自动扩大到其它域名或子域名。添加时检查入口，之后由你单独开启检索权限。</Text>
      <Text style={ui.detail}>搜索词发送至必应。只接收公开网页正文，不支持需登录、验证码、PDF或脚本才能显示的内容。</Text>
    </Card><Button label={create.isPending ? '检查入口中…' : '添加网站范围'} disabled={busy || !name.trim() || !entries.trim()} onPress={() => create.mutate()} /></>}
    {error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}
  </EditorPage>;
}
