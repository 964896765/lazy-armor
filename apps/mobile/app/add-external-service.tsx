import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
import { useExternalServices } from '../src/external-services';
export default function AddExternal() { const params = useLocalSearchParams<{ sourceUrl?: string; title?: string; importMethod?: string }>(); const [category, setCategory] = useState('生活'); const [name, setName] = useState(params.title ?? ''); const [url, setUrl] = useState(params.sourceUrl ?? ''); const [description, setDescription] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const add = useExternalServices(s => s.add);
 async function save() { let parsed: URL; try { parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw Error(); } catch { return setError('请输入有效的 http 或 https 具体服务链接'); } if (!name.trim()) return setError('请填写服务名称'); setBusy(true); try { await add({ id: `custom-${Date.now()}`, name: name.trim(), description, url: parsed.href, category, color: '#6F74E8', importMethod: params.importMethod === 'SHARE' ? 'SHARE' : 'MANUAL' }); router.canGoBack() ? router.back() : router.replace('/services' as never); } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); } finally { setBusy(false); } }
 return <EditorPage title="添加外部服务"><Card><Field label="服务名称" value={name} onChange={setName} max={50} placeholder="例如：上门保洁预约" /><Field label="具体服务链接" value={url} onChange={setUrl} max={1000} placeholder="https://" /><Text style={ui.label}>服务分类</Text><View style={[ui.line, { flexWrap: 'wrap' }]}>{['生活', '家庭', '出行', '健康', '工作', '其他'].map(value => <Pressable key={value} style={[ui.pill, category === value && { backgroundColor: '#BDD9FF' }]} onPress={() => setCategory(value)}><Text>{value}</Text></Pressable>)}</View><Field label="服务说明（选填）" value={description} onChange={setDescription} multiline />{error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}<Button label={busy ? '保存中…' : '添加服务'} disabled={busy} onPress={() => void save()} /></Card></EditorPage>; }



