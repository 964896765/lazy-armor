import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from './api';
import { Card, Button, ui } from './editor-ui';
import { ErrorState, LoadingState } from './consumer-ui';
interface Entry { id: string; version: number; title: string; content: string; sourceCurrent: boolean }
export function ReportDecisionPanel({ token, conversationId, messageId }: { token: string | undefined; conversationId: string; messageId: string }) {
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({ queryKey: ['report-decisions', token, conversationId, messageId, cursor], enabled: Boolean(token && conversationId && messageId),
    queryFn: () => api<{ items: Entry[]; nextCursor: string | null }>(`/memory/report-decisions?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId)}&limit=5${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token) });
  return <Card title="我的决策记录">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState detail="决策记录暂不可读取。" onRetry={() => void query.refetch()} /> : query.data?.items.length ? query.data.items.map(item => <View key={item.id}>
      <Text style={ui.title}>{item.title}</Text><Text selectable style={ui.detail}>{item.content}</Text>
      {!item.sourceCurrent ? <Text style={ui.detail}>报告版本已变化，这条历史决定不再用于理解后续目标。</Text> : null}
      <Button secondary label="查看来源或更正" onPress={() => router.push({ pathname: '/personal-memory/reference', params: { id: item.id, version: String(item.version) } } as never)} />
    </View>) : <Text style={ui.detail}>尚未保存针对这份报告的决定。</Text>}
    <Button secondary label="记录我的决策" onPress={() => router.push({ pathname: '/personal-memory/report-decision', params: { conversationId, messageId } } as never)} />
    {query.data?.nextCursor ? <Button secondary label="更早的决定" onPress={() => setCursor(query.data!.nextCursor!)} /> : null}
    {cursor ? <Button secondary label="返回最近决定" onPress={() => setCursor(undefined)} /> : null}
  </Card>;
}
