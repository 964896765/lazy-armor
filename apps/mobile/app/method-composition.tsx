import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { compositionAuthoringSelectionSchema, compositionResourceOptionsSchema, compositionOptionsSchema, compositionPreviewSchema, skillResourceGraphRequestSchema, type CompositionOptions, type SkillResourceGraphRequest } from '@lazy-armor/plan-schema/mobile';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
import { GoalBriefCard } from '../src/goal-brief-card';
import { reportResourceSelections, bindCompositionInput, compositionError, compositionFieldLabel, compositionIssueLabel, compositionSources } from '../src/composition-presenter';

export default function MethodCompositionPage() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>(), token = useAuthStore(state => state.token);
  const query = useQuery({ queryKey: ['composition-options', token, conversationId], enabled: Boolean(token && /^[0-9a-f-]{36}$/i.test(conversationId ?? '')),
    queryFn: async () => compositionOptionsSchema.parse(await api<unknown>(`/conversations/${conversationId}/composition-options`, token)) });
  useFocusEffect(useCallback(() => { if (token && /^[0-9a-f-]{36}$/i.test(conversationId ?? '')) void query.refetch(); }, [token, conversationId, query.refetch]));
  return <EditorPage title="能力组合">
    {!token ? <Button label="登录后核对能力" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <LoadingState /> : query.isError ? <>
      <Text style={ui.error}>{compositionError(query.error)}</Text><Button secondary label="重新读取" onPress={() => void query.refetch()} /><Button secondary label="选择规划方法" onPress={() => router.push('/method-selection' as never)} /></> : query.data ?
      <CompositionEditor key={`${token}:${query.dataUpdatedAt}`} options={query.data} token={token} reload={() => void query.refetch()} refreshing={query.isFetching} /> : <Text style={ui.detail}>请从原目标中打开能力组合。</Text>}
    {conversationId ? <Button secondary label="返回原目标" onPress={() => router.replace({ pathname: '/chat', params: { conversationId } } as never)} /> : null}
  </EditorPage>;
}
function CompositionEditor({ options, token, reload, refreshing }: { options: CompositionOptions; token: string; reload: () => void; refreshing: boolean }) {
  const client = useQueryClient();
  const [requestId, setRequestId] = useState(() => `composition-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [request, setRequest] = useState<SkillResourceGraphRequest>(() => options.suggested ?? { version: options.conversationVersion, links: [], goalBindings: [], deliveries: [] });
  const [resourceChoices, setResourceChoices] = useState<Record<string, string>>({});
  const reportGoal = options.goal?.outcomeKind === 'REPORT';
  const resources = useQuery({ queryKey: ['composition-resources', token, options.conversationId, options.conversationVersion], enabled: reportGoal,
    queryFn: async () => {
      const result = compositionResourceOptionsSchema.parse(await api<unknown>(`/conversations/${options.conversationId}/composition-resources`, token));
      if (result.conversationVersion !== options.conversationVersion || result.conversationId !== options.conversationId) throw new Error('COMPOSITION_CONTEXT_CHANGED');
      return result;
    } });
  const selectedResources = resources.data ? reportResourceSelections(resources.data, resourceChoices) : null;
  const preview = useMutation({ mutationFn: async (graph: SkillResourceGraphRequest) => compositionPreviewSchema.parse(await api<unknown>(`/conversations/${options.conversationId}/composition-preview`, token, { method: 'POST', body: JSON.stringify({ graph: skillResourceGraphRequestSchema.parse(graph) }) })) });
  const prepare = useMutation({ mutationFn: async () => {
    const checked = preview.data;
    if (!checked || checked.state !== 'STRUCTURE_VALID' || !checked.goalBriefRef) throw new Error('COMPOSITION_STRUCTURE_BLOCKED');
    if (reportGoal && (!resources.isSuccess || resources.isFetching || selectedResources === null)) throw new Error('COMPOSITION_RESOURCE_SELECTION_REQUIRED');
    const selection = compositionAuthoringSelectionSchema.parse({ ...(reportGoal && selectedResources?.length ? { resourceSelections: selectedResources } : {}), graph: request, basis: { goalBriefRef: checked.goalBriefRef, methodRefs: checked.methodRefs, sourceMessageRefs: checked.sourceMessageRefs } });
    const result = await api<{ id: string; mode: 'PLAN' | 'TEMPORARY' }>(`/conversations/${options.conversationId}/composition-authoring`, token, { method: 'POST', body: JSON.stringify({ requestId, selection }) });
    if (result.id !== options.conversationId) throw new Error('COMPOSITION_CONTEXT_CHANGED');
    return result;
  }, onSuccess: result => {
    void client.invalidateQueries({ queryKey: ['conversation', token, options.conversationId] });
    void client.invalidateQueries({ queryKey: ['conversations', token] });
    void client.invalidateQueries({ queryKey: ['goal-experience', token] });
    void client.invalidateQueries({ queryKey: ['experience-work-items', token] });
    router.replace({ pathname: '/chat', params: { conversationId: options.conversationId, mode: result.mode === 'PLAN' ? 'plan' : 'temporary' } } as never);
  } });
  const change = (next: SkillResourceGraphRequest) => { preview.reset(); prepare.reset(); setRequestId(`composition-${Date.now()}-${Math.random().toString(36).slice(2)}`); setResourceChoices({}); setRequest(next); };
  const blocked = refreshing || preview.isPending || prepare.isPending;
  return <>
    <Card title="核对能力如何衔接"><Text style={ui.detail}>已按字段名称与类型准备建议。核对每个输入的来源，再选择希望交付的成果。此预览只检查组合结构与当前资源，执行方案需在原目标中继续准备。</Text>
      <GoalBriefCard value={options.goal} /><Button secondary label="重新读取最新目标与方法" onPress={reload} disabled={blocked} /></Card>
    {options.methods.map(method => <Card key={method.ref.entryId} title={p.text(method.name)}>
      {!method.input || !method.output ? <Text style={ui.detail}>此方法尚未提供可组合的字段说明，可继续在原目标中作为规划参考。</Text> : <>
        {Object.keys(method.input.fields).map(field => <View key={field} style={{ gap: 4 }}><Text style={ui.label}>输入：{compositionFieldLabel(field)}{method.input!.required.includes(field) ? '（必填）' : ''}</Text>
          {compositionSources(options, method.ref.entryId, field).map((source, index) => {
            const selected = source.kind === 'GOAL' ? request.goalBindings.some(binding => binding.methodId === method.ref.entryId && binding.inputField === field && binding.goalField === source.field)
              : request.links.some(link => link.toMethodId === method.ref.entryId && link.inputField === field && link.fromMethodId === source.methodId && link.outputField === source.field);
            return <Button key={index} secondary label={`${selected ? '已选：' : ''}${p.text(source.label)}`} disabled={blocked} onPress={() => change(bindCompositionInput(request, method.ref.entryId, field, selected ? null : source))} />;
          })}
          {!compositionSources(options, method.ref.entryId, field).length ? <Text style={ui.detail}>没有匹配来源，请补充目标条件或方法说明。</Text> : null}
        </View>)}
        {Object.keys(method.output.fields).map(field => { const selected = request.deliveries.some(delivery => delivery.methodId === method.ref.entryId && delivery.outputField === field);
          return <Button key={field} secondary label={`${selected ? '已选成果：' : '选择成果：'}${compositionFieldLabel(field)}`} disabled={blocked || !selected && request.deliveries.length >= 12}
            onPress={() => change({ ...request, deliveries: selected ? request.deliveries.filter(delivery => delivery.methodId !== method.ref.entryId || delivery.outputField !== field) : [...request.deliveries, { methodId: method.ref.entryId, outputField: field, label: `${method.name} · ${field}`.slice(0, 120) }] })} />;
        })}
      </>}
    </Card>)}
    <Button label={preview.isPending ? '正在核对组合…' : '核对组合与当前资源'} disabled={blocked || !skillResourceGraphRequestSchema.safeParse(request).success} onPress={() => { prepare.reset(); preview.mutate(request); }} />
    {preview.isError ? <Text style={ui.error}>{compositionError(preview.error)}</Text> : null}
    {!refreshing && preview.data ? <Card title={preview.data.state === 'STRUCTURE_VALID' ? '组合结构已核对' : '组合仍需补充'}>
      {preview.data.orderedMethodIds.map((id, index) => <Text key={id} style={ui.detail}>{index + 1}. {p.text(options.methods.find(method => method.ref.entryId === id)?.name ?? '规划方法')}</Text>)}
      {preview.data.issues.map((issue, index) => <Text key={index} style={ui.detail}>{compositionIssueLabel(issue.code)}{issue.field ? `：${compositionFieldLabel(issue.field)}` : ''}</Text>)}
      {preview.data.nodes.filter(node => node.kind === 'RESOURCE_REQUIREMENT').map(node => node.kind === 'RESOURCE_REQUIREMENT' ? <Text key={node.id} style={ui.detail}>{p.text(node.capability)}：{node.state === 'OBSERVED_READY' ? '本次观察可用，执行前需再核对' : '尚需补充'}</Text> : null)}
      {reportGoal ? <View style={{ gap: 8 }}><Text style={ui.label}>本次固定读取来源</Text>
        {resources.isLoading ? <Text style={ui.detail}>正在核对已授权来源…</Text> : resources.isError ? <><Text style={ui.error}>{compositionError(resources.error)}</Text><Button secondary label="重新核对来源" disabled={blocked} onPress={() => { prepare.reset(); void resources.refetch(); }} /></> : null}
        {resources.data?.requirements.map(requirement => <View key={`${requirement.methodId}:${requirement.capabilityKey}`} style={{ gap: 4 }}>
          <Text style={ui.detail}>{p.text(options.methods.find(method => method.ref.entryId === requirement.methodId)?.name ?? '规划方法')} · {requirement.capabilityKey === 'READ_PUBLIC_WEB_RESEARCH' ? '公开网页原文' : '公开接口资料'}</Text>
          {requirement.candidates.map(candidate => { const selected = (resourceChoices[`${requirement.methodId}:${requirement.capabilityKey}`] ?? (requirement.candidates.length === 1 ? requirement.candidates[0].connectionId : undefined)) === candidate.connectionId;
            return <View key={candidate.connectionId} style={{ gap: 4 }}><Button secondary label={`${selected ? '已选：' : '选择：'}${p.text(candidate.name)}`} disabled={blocked || resources.isFetching} onPress={() => {
              prepare.reset(); setRequestId(`composition-${Date.now()}-${Math.random().toString(36).slice(2)}`);
              setResourceChoices(current => ({ ...current, [`${requirement.methodId}:${requirement.capabilityKey}`]: candidate.connectionId }));
            }} /><Button secondary label="查看此来源与授权范围" disabled={blocked} onPress={() => router.push({ pathname: requirement.capabilityKey === 'READ_PUBLIC_WEB_RESEARCH' ? '/public-web-resource' : '/interface-detail', params: { id: candidate.connectionId } } as never)} /></View>;
          })}
          {!requirement.candidates.length ? <Text style={ui.detail}>没有当前可读取的授权来源，请先补齐资源再重新核对。</Text> : null}
        </View>)}
        <Text style={ui.detail}>本次报告只使用这里选定的公开连接。授权、连接配置或来源状态变化后任务会停止，需要重新核对。</Text>
      </View> : null}
      <Text style={ui.detail}>核对时间：{p.dateTime(preview.data.evaluatedAt)}</Text><Text style={ui.detail}>可以把核对的输入来源、方法顺序和成果要求交给方案生成。生成会在后台继续；实际操作沿原审批流程。</Text>
      {preview.data.state === 'STRUCTURE_VALID' ? <Button label={prepare.isPending ? '正在保存组合并准备方案…' : '按此组合准备方案'} disabled={blocked || reportGoal && (!resources.isSuccess || resources.isFetching || selectedResources === null)} onPress={() => prepare.mutate()} /> : null}
    </Card> : null}
    {prepare.isError ? <Text style={ui.error}>{compositionError(prepare.error)}</Text> : null}
    <Button secondary label="查看所需资源与授权范围" disabled={blocked} onPress={() => router.push({ pathname: '/method-resources', params: { conversationId: options.conversationId, version: String(options.conversationVersion) } } as never)} />
  </>;
}
