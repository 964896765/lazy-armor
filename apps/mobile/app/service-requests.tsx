import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
interface RequestRow { request: { id: string; status: string; scheduledAt: string; requirement: string; address: string; version: number }; offering: { title: string }; nextAction: { label: string; status: string } | null }
export default function ServiceRequests() {
 const { id } = useLocalSearchParams<{ id?: string }>(); const token = useAuthStore(s => s.token); const client = useQueryClient(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
 const query = useQuery({ queryKey: ['service-requests', token], queryFn: () => api<RequestRow[]>('/service-requests', token), enabled: Boolean(token), refetchInterval: 15000 });
 async function cancel(item: RequestRow, status = 'CANCELLED') { setPending(true); try { await api(`/service-requests/${item.request.id}/status`, token, { method: 'POST', body: JSON.stringify({ status, version: item.request.version }) }); await query.refetch(); await client.invalidateQueries({ queryKey: ['timeline'] }); } catch (e) { setError(e instanceof Error ? e.message : '取消失败'); } finally { setPending(false); } }
 const rows = (query.data ?? []).filter(item => !id || item.request.id === id);
 return <EditorPage title="服务请求">{error ? <Text style={ui.error}>{presentation.error(error)}</Text> : null}{query.isLoading ? <ActivityIndicator /> : query.isError ? <Button label="读取失败，重试" onPress={() => void query.refetch()} /> : rows.map(item => <Card key={item.request.id} title={item.offering.title}><Text style={ui.label}>{({ PENDING: '待确认', BOOKED: '已预约', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<string, string>)[item.request.status] ?? '待处理'}</Text><Text style={ui.detail}>{presentation.dateTime(item.request.scheduledAt)}</Text><Text style={ui.detail}>{item.request.address}</Text><Text style={ui.detail}>{item.request.requirement}</Text>{item.nextAction ? <Button label={item.nextAction.label} disabled={pending} onPress={() => Alert.alert(item.nextAction!.label + '？', '确认后进度将同步到日程。', [{ text: '取消' }, { text: '确认', onPress: () => void cancel(item, item.nextAction!.status) }])} /> : null}{!['COMPLETED', 'CANCELLED'].includes(item.request.status) ? <Button secondary label="取消预约" disabled={pending} onPress={() => Alert.alert('取消预约？', '取消后服务提供方将不再继续此请求。', [{ text: '保留' }, { text: '取消预约', onPress: () => void cancel(item) }])} /> : null}</Card>)}{!query.isLoading && !query.isError && !rows.length ? <Text style={ui.detail}>暂无服务请求</Text> : null}</EditorPage>;
}
