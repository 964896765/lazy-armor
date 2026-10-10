import { skillRepositoryImportSchema, type SkillRepositoryImport, type SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';

export default function SkillImport() {
  const token = useAuthStore(s => s.token), client = useQueryClient();
  const [pack, setPack] = useState<SkillRepositoryImport | null>(null), [error, setError] = useState(''), [reading, setReading] = useState(false);
  const [url, setUrl] = useState(''), [remote, setRemote] = useState<{ url: string; contentHash: string } | null>(null);
  const preview = useMutation({ mutationFn: () => api<{ package: Omit<SkillRepositoryImport, 'requestId'>; contentHash: string; sourceUrl: string }>('/skill-repositories/preview', token,
      { method: 'POST', body: JSON.stringify({ url: url.trim() }) }),
    onSuccess: result => { setPack({ ...result.package, requestId: `source-${Date.now()}-${Math.random().toString(36).slice(2)}` }); setRemote({ url: result.sourceUrl, contentHash: result.contentHash }); setError(''); },
    onError: () => { setPack(null); setRemote(null); setError('来源未能读取，请使用公开 HTTPS 方法包；GitHub 文件需要固定提交版本。'); } });
  const choose = async () => {
    setReading(true); setError(''); setPack(null); setRemote(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', multiple: false, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.size || asset.size > 120000) throw new Error('SIZE');
      const parsed = skillRepositoryImportSchema.safeParse(JSON.parse(await FileSystem.readAsStringAsync(asset.uri)));
      if (!parsed.success) throw new Error('FORMAT');
      setPack(parsed.data);
    } catch { setError('请选择不超过 120 KB、包含来源与版本的有效方法包。'); }
    finally { setReading(false); }
  };
  const save = useMutation({ mutationFn: () => api<SkillRepositoryProjection>(remote ? '/skill-repositories/from-url' : '/skill-repositories', token,
      { method: 'POST', body: JSON.stringify(remote ? { ...remote, requestId: pack!.requestId } : { package: pack }) }),
    onSuccess: async repo => { await client.invalidateQueries({ queryKey: ['skill-repositories', token] }); router.replace(`/skill-repositories/${repo.id}` as never); },
    onError: () => setError('导入未完成或来源已变化，请重新预览后重试。') });
  const busy = reading || preview.isPending || save.isPending;
  return <EditorPage title="接入方法仓库"><Card title="选择方法包"><Text style={ui.detail}>导入后保持规划参考关闭。你可以查看方法、来源和所需能力，再选择启用。</Text>
    <Button label={reading ? '读取中…' : '选择方法包'} disabled={busy || !token} onPress={() => void choose()} /></Card>
    <Card title="从 GitHub 或网址接入"><Field label="方法包地址" value={url} max={2000} onChange={value => { setUrl(value); setPack(null); setRemote(null); }} />
      <Text style={ui.detail}>支持公开 JSON 方法包。GitHub 文件地址需使用固定提交版本；预览后导入时会再次核对内容。</Text>
      <Button label={preview.isPending ? '读取来源中…' : '预览来源'} disabled={busy || !token || !url.trim()} onPress={() => preview.mutate()} /></Card>
    {pack ? <Card title={p.text(pack.name)} detail={`${pack.entries.length} 个方法`}>
      <Text style={ui.detail}>{pack.sourceUrl ? p.text(pack.sourceUrl) : '我的方法'}</Text>
      {pack.entries.map(entry => <Text key={entry.name} style={ui.detail}>{p.text(entry.name)} · {entry.version} — {p.text(entry.description)}</Text>)}
      <Button label={save.isPending ? '导入中…' : '导入仓库'} disabled={busy || !token} onPress={() => save.mutate()} /></Card> : null}
    {error ? <Text style={ui.error}>{error}</Text> : null}{!token ? <Button label="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
  </EditorPage>;
}
