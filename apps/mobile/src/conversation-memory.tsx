import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import type { MemoryCandidate } from '@lazy-armor/plan-schema/mobile';
import { api } from './api';
import { Button, Card, ui } from './editor-ui';

export function ConversationMemoryPanel({ conversationId, token, conversationVersion }: { conversationId: string; token: string; conversationVersion?: number }) {
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({ queryKey: ['memory-candidates', token, conversationId, conversationVersion, cursor],
    queryFn: () => api<{ items: MemoryCandidate[]; nextCursor: string | null }>(`/memory/candidates?conversationId=${conversationId}&limit=10${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token) });
  if (query.isError) return <Button secondary label="记忆建议读取失败，重试" onPress={() => void query.refetch()} />;
  if (!query.data) return null;
  if (!query.data?.items.some(item => ['PENDING', 'CONFIRMED'].includes(item.status)) && !query.data?.nextCursor && !cursor) return null;
  return <Card title="个人记忆建议" detail="核对后才会保存，随时可以忽略。">
    {query.data.items.filter(item => ['PENDING', 'CONFIRMED'].includes(item.status)).map(candidate => <View key={candidate.id} style={ui.listRow}>
      {candidate.status === 'PENDING' ? <><Text style={ui.title}>{candidate.title}</Text><Text style={ui.detail}>{candidate.quote}</Text>
        <Button secondary label="核对这条信息" onPress={() => router.push({ pathname: '/personal-memory/candidate', params: { id: candidate.id } } as never)} /></>
        : candidate.memoryId ? <Button secondary label="查看已确认的信息" onPress={() => router.push({ pathname: '/personal-memory/reference', params: { id: candidate.memoryId!, version: String(candidate.confirmedMemoryVersion) } } as never)} /> : null}
    </View>)}
    {query.data.nextCursor ? <Button secondary label="较早建议" onPress={() => setCursor(query.data!.nextCursor!)} /> : null}
    {cursor ? <Button secondary label="最近建议" onPress={() => setCursor(undefined)} /> : null}
  </Card>;
}
export function MemoryReferences({ refs }: { refs?: Array<{ id: string; version: number }> }) {
  if (!refs?.length) return null;
  return <View style={{ gap: 4 }}><Text style={ui.detail}>这次理解参考了你确认保存的个人信息。</Text>
    {refs.slice(0, 8).map((ref, index) => <Button key={ref.id} secondary label={`查看个人信息 ${index + 1}`} onPress={() => router.push({ pathname: '/personal-memory/reference', params: { id: ref.id, version: String(ref.version) } } as never)} />)}
  </View>;
}
