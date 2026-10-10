import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { GITHUB_TRENDING_URL, githubDigestPlan, isGithubDigestDefinition } from '@lazy-armor/plan-schema/mobile';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';

type Plan = { id: string; status: string; currentVersion: { versionNumber: number }; activeVersion: { versionNumber: number } | null; activeVersionId: string | null };
export default function GithubDigestPage() {
  const params = useLocalSearchParams<{ planId?: string; connectionId?: string }>(), token = useAuthStore(s => s.token), client = useQueryClient();
  const [selected, setSelected] = useState(params.connectionId ?? '');
  const resources = useQuery({ queryKey: ['github-digest-resources', token], enabled: Boolean(token), queryFn: async () => {
    const connections = await api<Array<{ id: string; connectorId: string; externalAccountName: string }>>('/connections', token);
    return (await Promise.all(connections.filter(c => c.connectorId === 'public_web_research').map(async c => {
      const [scope, permissions] = await Promise.all([api<{ origins: string[] }>(`/connections/${c.id}/public-web-scope`, token), api<Array<{ capability: string; granted: boolean }>>(`/connections/${c.id}/permissions`, token)]);
      return { ...c, inScope: scope.origins.includes('https://github.com'), allowed: permissions.some(p => p.capability === 'READ_PUBLIC_WEB_RESEARCH' && p.granted) };
    }))).filter(c => c.inScope);
  } });
  const plan = useQuery({ queryKey: ['github-digest-plan', token, params.planId], enabled: Boolean(token && params.planId), queryFn: () => api<Plan>(`/plans/${params.planId}`, token) });
  const versionNumber = plan.data?.activeVersion?.versionNumber ?? plan.data?.currentVersion?.versionNumber;
  const version = useQuery({ queryKey: ['github-digest-version', token, params.planId, versionNumber], enabled: Boolean(token && params.planId && versionNumber),
    queryFn: () => api<{ definition: Parameters<typeof isGithubDigestDefinition>[0] }>(`/plans/${params.planId}/versions/${versionNumber}`, token) });
  const definitionValid = Boolean(version.data && isGithubDigestDefinition(version.data.definition));
  const connectionId = params.planId ? version.data?.definition.sources[0]?.connectionId : selected || resources.data?.find(c => c.allowed)?.id || resources.data?.[0]?.id;
  const resource = resources.data?.find(c => c.id === connectionId), ready = Boolean(resource);
  const create = useMutation({ mutationFn: () => api<Plan>('/plans', token, { method: 'POST', body: JSON.stringify(githubDigestPlan(connectionId!)) }), onSuccess: async row => {
    await client.invalidateQueries({ queryKey: ['plans', token] }); router.replace({ pathname: '/github-digest', params: { planId: row.id } } as never);
  } });
  const start = useMutation({ mutationFn: async () => {
    if (!resource?.allowed) throw new Error('请先亲自开启此 GitHub 范围的网页读取权限');
    const current = await api<Plan>(`/plans/${params.planId}`, token);
    const reviewedNumber = current.activeVersion?.versionNumber ?? current.currentVersion.versionNumber;
    const reviewed = await api<{ id: string; definition: Parameters<typeof isGithubDigestDefinition>[0] }>(`/plans/${current.id}/versions/${reviewedNumber}`, token);
    if (reviewedNumber !== versionNumber || !isGithubDigestDefinition(reviewed.definition) || reviewed.definition.sources[0]?.connectionId !== connectionId) throw new Error('计划已变化，请重新审阅');
    if (current.status === 'draft') await api(`/plans/${current.id}/status`, token, { method: 'POST', body: JSON.stringify({ status: 'ready' }) });
    if (!current.activeVersionId) await api(`/plans/${current.id}/versions/${current.currentVersion.versionNumber}/apply`, token, { method: 'POST' });
    return api<Plan>(`/plans/${current.id}/status`, token, { method: 'POST', body: JSON.stringify({ status: 'active', expectedVersionId: reviewed.id }) });
  }, onSuccess: async row => { await client.invalidateQueries({ queryKey: ['plans', token] }); router.replace(`/plans/${row.id}` as never); } });
  const run = useMutation({ mutationFn: () => api<{ id: string }>(`/plans/${params.planId}/executions`, token, { method: 'POST', body: JSON.stringify({ requestId: `github-manual:${Date.now()}`, triggerPayload: {} }) }),
    onSuccess: row => router.push(`/executions/${row.id}` as never) });
  const busy = create.isPending || start.isPending || run.isPending;
  const error = resources.error ?? plan.error ?? version.error ?? create.error ?? start.error ?? run.error;
  return <EditorPage title="每天 GitHub 前 10">
    <Card title="持续目标">
      <Text style={ui.detail}>公开 Trending 日榜 · 所有语言 · 前 10</Text><Text selectable style={ui.detail}>{GITHUB_TRENDING_URL}</Text>
      <Text style={ui.detail}>每天北京时间 09:00，由 App 读取当天榜单、自动编写提示词并生成十项中文摘要，发送站内通知。可在计划页暂停。</Text>
      <Text style={ui.detail}>保留真实排名、仓库链接、读取时间和页面星标数；对比上次成功汇总的名次。首日没有基线，不编造昨天的数据。榜单未包含提交或发行日志。</Text>
      <Text style={ui.detail}>无法读取或不足十项时保留失败记录。服务停机错过当日时刻不补造当天记录。</Text>
    </Card>
    {!token ? <Button label="登录后准备" onPress={() => router.push('/auth/login' as never)} /> : params.planId ? <Card title="审阅计划">
      <Text style={ui.detail}>状态：{plan.data?.status === 'active' ? '已启动' : '等待审阅启动'}</Text>
      {version.data && !definitionValid ? <Text style={ui.error}>本版本不是此 GitHub 每日汇总，请在原计划页审阅。</Text> : null}
      <Text style={ui.detail}>读取范围：{resource?.externalAccountName ?? '核对中'} · {resource?.allowed ? '已授权' : '未授权'}</Text>
      {!resource?.allowed && connectionId ? <><Button secondary label="查看 GitHub 范围并授权" onPress={() => router.push({ pathname: '/public-web-resource', params: { id: connectionId } } as never)} /><Button secondary label="刷新授权状态" onPress={() => resources.refetch()} /></> : null}
      {plan.data?.status === 'active' ? <><Button label="读取一次并生成摘要" disabled={busy || !definitionValid || !resource?.allowed} onPress={() => run.mutate()} /><Button secondary label="打开计划与七天记录" onPress={() => router.push(`/plans/${params.planId}` as never)} /></> :
        <Button label={start.isPending ? '启动中…' : '审阅并启动每日计划'} disabled={busy || !definitionValid || !resource?.allowed || !plan.data || !['draft', 'ready', 'paused'].includes(plan.data.status)} onPress={() => Alert.alert('启动每天 GitHub 前 10？', '每天北京时间 09:00 读取已授权的公开 GitHub 日榜，自动生成摘要并发送站内通知。可随时在计划页暂停。', [{ text: '取消' }, { text: '启动', onPress: () => start.mutate() }])} />}
    </Card> : <Card title="GitHub 读取资源">
      {resources.data?.map(c => <Card key={c.id}><Text style={ui.detail}>{c.externalAccountName} · {c.allowed ? '已授权' : '未授权'}</Text>
        <Button secondary label={connectionId === c.id ? '已选择此范围' : '选择此范围'} disabled={busy} onPress={() => setSelected(c.id)} />
        {!c.allowed ? <Button secondary label="查看范围并授权" onPress={() => router.push({ pathname: '/public-web-resource', params: { id: c.id } } as never)} /> : null}</Card>)}
      <Button secondary label="添加 GitHub 网站范围" onPress={() => router.push({ pathname: '/public-web-resource', params: { entryUrls: GITHUB_TRENDING_URL } } as never)} />
      <Button secondary label="刷新授权状态" onPress={() => resources.refetch()} />
      <Button label={create.isPending ? '准备中…' : '准备可审阅的每日计划'} disabled={busy || !ready} onPress={() => create.mutate()} />
    </Card>}
    {error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}
  </EditorPage>;
}
