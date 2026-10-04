import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
interface Projection { id: string; conversationId: string; executionId: string | null; status: string; outcome: { title: string; detail?: string } | null; primaryAction?: { label: string; path: string } }
export default function OnceRequest() {
 const { id } = useLocalSearchParams<{ id: string }>(); const token = useAuthStore(s => s.token);
 const query = useQuery({ queryKey: ['once-request', token, id], queryFn: () => api<Projection>(`/once-requests/${id}`, token), enabled: Boolean(token && id), refetchInterval: 3000 });
 return <EditorPage title="本次运行">{query.data ? <Card title={presentation.reason(query.data.status)}><Text style={ui.detail}>{presentation.text(query.data.outcome?.detail)}</Text>{query.data.primaryAction ? <Button label={query.data.primaryAction.label} onPress={() => router.push(query.data!.primaryAction!.path as never)} /> : null}<Button secondary label="返回会话" onPress={() => router.push(`/chat?conversationId=${query.data!.conversationId}` as never)} /></Card> : query.isError ? <Button secondary label="读取失败，重试" onPress={() => void query.refetch()} /> : <Text style={ui.detail}>读取后端运行状态…</Text>}</EditorPage>;
}
