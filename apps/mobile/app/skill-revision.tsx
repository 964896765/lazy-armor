import type { SkillCapability, SkillRepositoryProjection, SkillRevisionHistory } from '@lazy-armor/plan-schema/mobile';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
import { prepareSkillRevision, skillRevisionChanges, skillRevisionError, skillRevisionPreviewState, type SkillRevisionPreview } from '../src/skill-revisions';
import { riskLevelLabel } from '../src/today-presenter';

export default function SkillRevisionPage() {
  const { repositoryId, entryId } = useLocalSearchParams<{ repositoryId: string; entryId: string }>();
  const token = useAuthStore(s => s.token), client = useQueryClient();
  const valid = /^[0-9a-f-]{36}$/i.test(repositoryId ?? '') && /^[0-9a-f-]{36}$/i.test(entryId ?? '');
  const scope = `${token}:${repositoryId}:${entryId}`, latestScope = useRef(scope), selection = useRef(0);
  latestScope.current = scope;
  const [preview, setPreview] = useState<SkillRevisionPreview | null>(null), [error, setError] = useState(''), [reading, setReading] = useState(false), [savedVersion, setSavedVersion] = useState('');
  useEffect(() => { selection.current++; setPreview(null); setError(''); setReading(false); setSavedVersion(''); }, [scope]);
  const repository = useQuery({ queryKey: ['skill-repository', token, repositoryId], enabled: Boolean(token && valid), staleTime: 0,
    queryFn: () => api<SkillRepositoryProjection>(`/skill-repositories/${repositoryId}`, token) });
  const history = useInfiniteQuery({ queryKey: ['skill-revisions', token, repositoryId, entryId], enabled: Boolean(token && valid),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<SkillRevisionHistory>(`/skill-repositories/${repositoryId}/entries/${entryId}/revisions?limit=10${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, token),
    getNextPageParam: page => page.nextCursor ?? undefined });
  useFocusEffect(useCallback(() => { if (token && valid) { void repository.refetch(); void history.refetch(); } }, [token, valid, repository.refetch, history.refetch]));
  const repo = repository.data, entry = repo?.entries.find(item => item.id === entryId);
  const choose = async () => {
    if (!repo || !entry || repo.status !== 'ACTIVE') return;
    const generation = ++selection.current;
    setReading(true); setPreview(null); setError(''); setSavedVersion('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', multiple: false, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.size || asset.size > 120000) throw new Error('请选择不超过 120 KB 的方法文件。');
      const prepared = prepareSkillRevision(await FileSystem.readAsStringAsync(asset.uri), repo, entryId);
      if (latestScope.current === scope && selection.current === generation && useAuthStore.getState().token === token) setPreview(prepared);
    } catch (failure) {
      if (latestScope.current === scope && selection.current === generation) setError(p.error(failure));
    } finally { if (latestScope.current === scope && selection.current === generation) setReading(false); }
  };
  const save = useMutation({ retry: false, mutationFn: (chosen: SkillRevisionPreview) => api<SkillRepositoryProjection>(`/skill-repositories/${chosen.repositoryId}/entries/${chosen.entryId}/revisions`, token,
    { method: 'POST', body: JSON.stringify({ version: chosen.repositoryVersion, manifest: chosen.manifest }) }),
    onMutate: () => ({ scope, token }),
    onSuccess: async (updated, chosen, context) => {
      if (useAuthStore.getState().token !== context?.token || latestScope.current !== context?.scope) return;
      client.setQueryData(['skill-repository', token, updated.id], updated);
      setPreview(null); setError(''); setSavedVersion(chosen.manifest.version);
      await Promise.all([client.invalidateQueries({ queryKey: ['skill-repositories', token] }),
        client.invalidateQueries({ queryKey: ['skill-revisions', token, updated.id] }), client.invalidateQueries({ queryKey: ['conversation', token] })]);
    }, onError: (failure, _chosen, context) => {
      if (useAuthStore.getState().token !== context?.token || latestScope.current !== context?.scope) return;
      setError(skillRevisionError(failure)); void repository.refetch(); void history.refetch();
    } });
  const state = preview && repo ? skillRevisionPreviewState(preview, repo) : null;
  const busy = reading || save.isPending || repository.isFetching;
  const revisions = [...new Map((history.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values()];
  return <EditorPage title="方法版本">
    {!token ? <Button label="登录后管理版本" onPress={() => router.push('/auth/login' as never)} /> : !valid ? <Text style={ui.error}>请从方法仓库打开。</Text>
      : repository.isLoading ? <LoadingState /> : repository.isError ? <><Text style={ui.error}>仓库读取失败，请重试。</Text><Button secondary label="重新读取" onPress={() => void repository.refetch()} /></>
        : repo && entry ? <>
          <Card title={p.text(entry.manifest.name)} detail={`当前版本 ${entry.manifest.version}`}>
            <Text style={ui.detail}>追加版本会用于后续规划参考。旧会话保留原选择，需要重新选择方法；已确认计划继续保留原版本依据。</Text>
            <Text style={ui.detail}>{repo.enabled ? '规划参考已启用，更新后保持启用。' : '规划参考已关闭，更新不会自动启用。'}</Text>
            <Text style={ui.detail}>文件内容由你提供。仓库来源是最初导入时的声明，不代表更新内容已由原作者验证。</Text>
            {repo.status === 'ACTIVE' ? <><Text style={ui.detail}>选择单个方法声明或方法包 JSON，仅更新同名方法；请使用未用过的版本号。</Text>
              <Button label={reading ? '读取中…' : '选择新版本文件'} disabled={busy} onPress={() => void choose()} /></>
              : <Text style={ui.detail}>仓库已移出，版本历史仍可查看。</Text>}
          </Card>
          {preview ? <Card title="核对新版本" detail={`${preview.previous.version} → ${preview.manifest.version}`}>
            <Text style={ui.detail}>变化：{skillRevisionChanges(preview.previous, preview.manifest).join('、') || '仅版本号变化'}</Text>
            <ManifestDetails manifest={preview.manifest} />
            {state === 'STALE' ? <Text style={ui.error}>仓库已变化，请重新选择文件并核对。</Text> : state === 'SAVED' ? <Text style={ui.detail}>当前版本已包含这份内容，无需重复更新。</Text>
              : <Button label={save.isPending ? '更新中…' : '确认追加版本'} disabled={busy} onPress={() => save.mutate(preview)} />}
          </Card> : null}
          {savedVersion ? <Text style={ui.detail}>版本 {savedVersion} 已追加，旧版本和计划依据保留。</Text> : null}
          {error ? <Text style={ui.error}>{error}</Text> : null}
          <Card title="版本历史"><Text style={ui.detail}>按追加时间展示。历史内容只读，不能覆盖或重新设为当前版本。</Text>
            {history.isLoading ? <LoadingState /> : null}
            {revisions.map(revision => <Card key={revision.id} title={`版本 ${revision.version}`} detail={`${revision.id === entry.revisionId ? '当前版本' : '历史版本'} · ${p.dateTime(revision.createdAt)}`}>
              <ManifestDetails manifest={revision.manifest} />
            </Card>)}
            {history.isError ? <><Text style={ui.error}>版本历史读取失败。</Text><Button secondary label="重新读取历史" onPress={() => void history.refetch()} /></> : null}
            {history.hasNextPage ? <Button secondary label={history.isFetchingNextPage ? '加载中…' : '更多历史版本'} disabled={history.isFetching} onPress={() => void history.fetchNextPage()} /> : null}
          </Card>
        </> : <Text style={ui.error}>方法不存在，请返回仓库核对。</Text>}
    {valid ? <Button secondary label="返回方法仓库" disabled={reading || save.isPending} onPress={() => router.replace(`/skill-repositories/${repositoryId}` as never)} /> : null}
  </EditorPage>;
}

function ManifestDetails({ manifest }: { manifest: SkillCapability }) {
  return <><Text style={ui.detail}>{p.text(manifest.description)}</Text>
    <Text style={ui.detail}>所需能力：{manifest.requiredCapabilities.map(key => p.capability(key)).join('、') || '未声明外部能力'}</Text>
    <Text style={ui.detail}>声明风险：{riskLevelLabel(manifest.risk)}</Text>
    <Text style={ui.detail}>权限声明：{manifest.permission.map(value => ({ READ: '读取', WRITE: '写入', NOTIFY: '提醒' })[value]).join('、') || '未声明'}</Text>
    <Text style={ui.detail}>核实方式：{manifest.verification.map(value => ({ READ_BACK: '回读核对', USER_CONFIRMATION: '本人核实', PROVIDER_RECEIPT: '来源回执', STRUCTURED_EVIDENCE: '结构化证据' })[value]).join('、')}</Text>
    <Text style={ui.detail}>{p.text(manifest.instruction)}</Text></>;
}
