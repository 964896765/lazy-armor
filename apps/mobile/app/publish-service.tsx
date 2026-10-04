import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
const domains = [{ value: 'life', label: '生活' }, { value: 'family', label: '家庭' }, { value: 'travel', label: '出行' }, { value: 'health', label: '健康' }, { value: 'work', label: '工作' }, { value: 'other', label: '其他' }];
export default function PublishService() {
 const token = useAuthStore(s => s.token); const client = useQueryClient();
 const [title, setTitle] = useState(''); const [summary, setSummary] = useState(''); const [contact, setContact] = useState(''); const [area, setArea] = useState(''); const [imageUrl, setImageUrl] = useState(''); const [price, setPrice] = useState(''); const [domain, setDomain] = useState('life'); const [deliveryMode, setDeliveryMode] = useState('LOCAL'); const [error, setError] = useState('');
 const [imageMedia, setImageMedia] = useState<{ id: string; uri: string } | null>(null);
 const upload = useMutation({ mutationFn: async () => {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null; const asset = picked.assets[0];
  if (!asset?.size || asset.size > 8000000) throw new Error('请选择最大 8 MB 的静态图片');
  const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const result = await api<{ id: string }>('/service-media', token, { method: 'POST', body: JSON.stringify({ requestId: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`, contentBase64 }) });
  return { id: result.id, uri: asset.uri };
 }, onSuccess: image => { if (image) { setImageMedia(image); setImageUrl(''); } setError(''); }, onError: e => setError(e.message) });
 const [requestId] = useState(() => `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const publish = useMutation({ mutationFn: () => {
  let priceMinor: number | undefined;
  if (price.trim()) { if (!/^\d{1,6}(\.\d{1,2})?$/.test(price.trim())) throw new Error('请输入有效价格，最多两位小数'); const [whole, cents = ''] = price.trim().split('.'); priceMinor = Number(whole) * 100 + Number(cents.padEnd(2, '0')); }
  return api('/service-offerings', token, { method: 'POST', body: JSON.stringify({ requestId, title, summary, contact, serviceArea: area, domain, deliveryMode, priceMinor, ...(imageMedia ? { imageMediaId: imageMedia.id } : {}), ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}), confirmed: true }) });
 }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['service-offerings'] }); await client.invalidateQueries({ queryKey: ['service-provider-profile'] }); router.canGoBack() ? router.back() : router.replace('/services' as never); }, onError: e => setError(e.message) });
 return <EditorPage title="发布内部服务">{!token ? <Button label="登录后发布服务" onPress={() => router.push('/auth/login' as never)} /> : <>
  <Card><Field label="服务名称" value={title} onChange={setTitle} max={160} /><Field label="服务说明" value={summary} onChange={setSummary} max={600} multiline /><Field label="服务图片链接（选填）" value={imageUrl} onChange={value => { setImageUrl(value); if (value.trim()) setImageMedia(null); }} max={1000} placeholder="公开 HTTPS 图片地址" />
   <Button secondary label={upload.isPending ? '上传中…' : '从手机选择服务图片'} disabled={upload.isPending || publish.isPending} onPress={() => upload.mutate()} />{imageMedia ? <><Image source={{ uri: imageMedia.uri }} style={{ width: '100%', height: 160 }} resizeMode="contain" /><Button secondary label="移除图片" onPress={() => setImageMedia(null)} /></> : null}<Text style={ui.detail}>图片确认发布后公开展示，上传时会去除定位等元数据。</Text><Text style={ui.label}>服务分类</Text><View style={[ui.line, { flexWrap: 'wrap' }]}>{domains.map(item => <Pressable key={item.value} style={[ui.pill, domain === item.value && { backgroundColor: '#BDD9FF' }]} onPress={() => setDomain(item.value)}><Text>{item.label}</Text></Pressable>)}</View>
   <Text style={ui.label}>服务方式</Text><View style={ui.line}>{[{ value: 'LOCAL', label: '上门服务' }, { value: 'REMOTE', label: '远程服务' }].map(item => <Pressable key={item.value} style={[ui.pill, deliveryMode === item.value && { backgroundColor: '#BDD9FF' }]} onPress={() => setDeliveryMode(item.value)}><Text>{item.label}</Text></Pressable>)}</View>
   <Field label={deliveryMode === 'LOCAL' ? '服务区域' : '交付范围'} value={area} onChange={setArea} max={300} placeholder={deliveryMode === 'LOCAL' ? '例如：所在城市与服务区域' : '例如：线上交付'} /><Field label="价格（元，选填）" value={price} onChange={setPrice} max={10} placeholder="留空表示费用需协商" /><Field label="公开联系方式" value={contact} onChange={setContact} max={160} />
  </Card>{error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}<Button label={publish.isPending ? '发布中…' : '确认发布服务'} disabled={publish.isPending || upload.isPending || !title.trim() || !summary.trim() || !area.trim() || !contact.trim()} onPress={() => Alert.alert('确认公开发布？', `${title}\n${deliveryMode === 'LOCAL' ? '上门' : '远程'} · ${area}\n公开联系方式：${contact}\n费用：${price.trim() ? price + ' 元' : '需协商'}`, [{ text: '取消' }, { text: '确认发布', onPress: () => publish.mutate() }])} />
 </>}</EditorPage>;
}
