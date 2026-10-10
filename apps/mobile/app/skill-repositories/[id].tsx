import type { SkillRepositoryProjection } from '@lazy-armor/plan-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Text } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, Card, EditorPage, ui } from '../../src/editor-ui';
import { ErrorState, LoadingState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../src/consumer-presentation';
import { riskLevelLabel } from '../../src/today-presenter';

export default function Repository() {
  const { id } = useLocalSearchParams<{ id: string }>(), token = useAuthStore(s => s.token), client = useQueryClient();
  const query = useQuery({ queryKey: ['skill-repository', token, id], queryFn: () => api<SkillRepositoryProjection>(`/skill-repositories/${id}`, token), enabled: Boolean(token && id) });
  const change = useMutation({ mutationFn: (archive: boolean) => api<SkillRepositoryProjection>(`/skill-repositories/${id}${archive ? '' : '/planning'}`, token,
    { method: archive ? 'DELETE' : 'POST', body: JSON.stringify({ version: query.data!.version, ...(!archive ? { enabled: !query.data!.enabled } : {}) }) }),
    onSuccess: async (_, archive) => { await client.invalidateQueries({ queryKey: ['skill-repositories', token] }); await query.refetch(); if (archive) router.replace('/plans?view=skills' as never); } });
  const repo = query.data;
  return <EditorPage title="方法仓库">{!token ? <Button label="去登录" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : repo ? <>
    <Card title={p.text(repo.name)} detail={`${repo.entries.length} 个方法 · 用户导入`}>
      {repo.sourceUrl ? <Button secondary label="查看声明来源" onPress={() => { const url = new URL(repo.sourceUrl!); if (url.protocol === 'https:') void Linking.openURL(repo.sourceUrl!); }} /> : null}
      <Text style={ui.detail}>来源由导入者提供。启用后将方法内容提供给 AI 作为规划参考；具体执行还需资源与权限核对。关闭后影响后续建议，已确认计划保留原版本依据。</Text>
      {repo.status === 'ACTIVE' ? <Button label={repo.enabled ? '关闭规划参考' : '启用规划参考'} disabled={change.isPending} onPress={() => change.mutate(false)} /> : null}
    </Card>{repo.entries.map(entry => <Card key={entry.id} title={p.text(entry.manifest.name)} detail={`版本 ${entry.manifest.version}`}>
      <Text style={ui.detail}>{p.text(entry.manifest.description)}</Text><Text style={ui.detail}>声明风险：{riskLevelLabel(entry.manifest.risk)}</Text>
      <Text style={ui.detail}>所需能力：{entry.manifest.requiredCapabilities.map(capability => p.capability(capability)).join('、') || '无需外部能力'}</Text>
      <Text style={ui.detail}>{p.text(entry.manifest.instruction)}</Text>
    </Card>)}{repo.status === 'ACTIVE' ? <Button secondary label="移出仓库列表" disabled={change.isPending} onPress={() => change.mutate(true)} /> : null}
    {change.isError ? <Text style={ui.error}>操作未完成或仓库已更新，请刷新后重试。</Text> : null}
  </> : null}</EditorPage>;
}
