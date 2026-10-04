import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
export default function RequestService() {
 const { offeringId } = useLocalSearchParams<{ offeringId: string }>();
 const token = useAuthStore(s => s.token); const client = useQueryClient();
 const [scheduledAt, setScheduledAt] = useState(''); const [address, setAddress] = useState(''); const [contact, setContact] = useState(''); const [requirement, setRequirement] = useState(''); const [error, setError] = useState('');
 const [requestId] = useState(() => `request-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const submit = useMutation({ mutationFn: () => {
  const date = new Date(scheduledAt.replace(' ', 'T') + '+08:00');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(scheduledAt) || !Number.isFinite(date.getTime())) throw new Error('请输入预约时间，例如 2026-10-04 10:00');
  return api('/service-requests', token, { method: 'POST', body: JSON.stringify({ offeringId, requestId, scheduledAt: date.toISOString(), address, contact, requirement, confirmed: true }) });
 }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['timeline'] }); await client.invalidateQueries({ queryKey: ['service-requests'] }); router.replace('/service-requests' as never); }, onError: e => setError(e.message) });
 return <EditorPage title="预约服务"><Card><Field label="预约时间（北京时间）" value={scheduledAt} onChange={setScheduledAt} placeholder="2026-10-04 10:00" /><Field label="服务地址 / 交付方式" value={address} onChange={setAddress} /><Field label="联系方式" value={contact} onChange={setContact} /><Field label="需求说明" value={requirement} onChange={setRequirement} multiline /><Text style={ui.detail}>提交后等待服务提供方确认，预约与进度会显示在日程。</Text></Card>{error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}<Button label={submit.isPending ? '提交中…' : '确认发起服务请求'} disabled={submit.isPending || !address.trim() || !contact.trim()} onPress={() => Alert.alert('确认预约？', `预约时间：${scheduledAt}\n服务地址：${address}`, [{ text: '取消' }, { text: '确认', onPress: () => submit.mutate() }])} /></EditorPage>;
}
