import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { useExternalServices } from '../src/external-services';

interface Reference {
 id: string; title: string; summary: string; sourceUrl: string; sourcePlatform: string;
 providerName: string | null; category: string; priceSnapshot: string | null;
 availability: 'NOT_VERIFIED'; primaryAction: { label: string; url: string };
}

export default function ExternalServiceDetail() {
 const { id } = useLocalSearchParams<{ id: string }>();
 const token = useAuthStore(s => s.token);
 const query = useQuery({ queryKey: ['external-service', token, id], queryFn: () => api<Reference>(`/external-services/${id}`, token), enabled: Boolean(token && id) });
 const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
 const item = query.data;
 async function open() {
  if (!item) return;
  setBusy(true); setError('');
  try { await WebBrowser.openBrowserAsync(item.primaryAction.url, { toolbarColor: '#EDF4FF', showTitle: true, enableDefaultShareMenuItem: true }); }
  catch { setError('原服务暂时无法打开，请稍后重试'); }
  finally { setBusy(false); }
 }
 async function remove() {
  if (!item) return;
  setBusy(true);
  try { await useExternalServices.getState().remove(item.id); router.canGoBack() ? router.back() : router.replace('/services' as never); }
  catch { setError('移除失败，请重试'); setBusy(false); }
 }
 return <EditorPage title="外部服务详情">{!token ? <Button label="登录后查看服务" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <ActivityIndicator /> : query.isError ? <Button secondary label="读取失败，重试" onPress={() => void query.refetch()} /> : item ? <>
  <Card title={item.title}><Text style={ui.detail}>{item.summary || '暂无补充说明'}</Text><Text style={ui.pill}>{item.category}</Text></Card>
  <Card title="原服务来源"><Text style={ui.label}>{item.sourcePlatform}</Text>{item.providerName ? <Text style={ui.detail}>{item.providerName}</Text> : null}<Text selectable style={ui.detail}>{item.sourceUrl}</Text>{item.priceSnapshot ? <Text style={ui.detail}>保存时价格：{item.priceSnapshot}</Text> : null}<Text style={ui.detail}>这是你保存的服务引用。当前价格、库存与预约状态以原服务页面为准。</Text></Card>
  {error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}
  <Button label={busy ? '处理中…' : item.primaryAction.label} disabled={busy} onPress={() => void open()} />
  <Button secondary label="围绕此服务创建计划" disabled={busy} onPress={() => router.push({ pathname: '/chat', params: { mode: 'plan', externalServiceId: item.id } } as never)} />
  <Button secondary label="移除服务引用" disabled={busy} onPress={() => Alert.alert('移除此服务引用？', '只移除装甲中的引用，不会取消原平台上的订单或预约。', [{ text: '保留' }, { text: '移除', style: 'destructive', onPress: () => void remove() }])} />
 </> : null}</EditorPage>;
}
