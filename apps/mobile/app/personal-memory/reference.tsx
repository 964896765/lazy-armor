import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import type { MemoryReference } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EditorPage, Button, Card, ui } from '../../src/editor-ui';
import { ErrorState, LoadingState } from '../../src/consumer-ui';
import { memoryReferenceLabel, memorySourceLabel, memoryTypeLabels } from '../../src/memory-presenter';
import { formatTime } from '../../src/plan-presenter';
export default function MemoryReferencePage() {
  const { id, version } = useLocalSearchParams<{ id: string; version: string }>(), token = useAuthStore(state => state.token);
  const query = useQuery({ queryKey: ['memory-reference', token, id, version], queryFn: () => api<MemoryReference>(`/memory/${id}/reference?version=${encodeURIComponent(version)}`, token), enabled: Boolean(id && version && token) });
  return <EditorPage title="个人信息与来源">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data ? <>
      <Text style={ui.detail}>{memoryReferenceLabel(query.data.state)}</Text>
      {query.data.memory ? <Card title={query.data.memory.title} detail={memoryTypeLabels[query.data.memory.type]}><Text selectable style={ui.detail}>{query.data.memory.content}</Text>
        <Text style={ui.detail}>{memorySourceLabel(query.data.memory)} · {formatTime(query.data.memory.confirmedAt)}</Text>
        <Button secondary label="编辑或删除" onPress={() => router.push({ pathname: '/personal-memory/edit', params: { id } } as never)} /></Card> : null}
      {query.data.memory ? <Button secondary label="查看个人信息关联" onPress={() => router.push({ pathname: '/personal-memory/relations', params: { id } } as never)} /> : null}
      <Card title="来源"><Text selectable style={ui.detail}>{query.data.source.content ?? (query.data.source.kind === 'USER_INPUT' ? '你在个人记忆页明确确认提供。' : query.data.source.kind === 'REPORT_DECISION_CONFIRMED' ? '原报告已变化或不可查看。' : query.data.source.kind === 'LEARNING_CONFIRMED' ? '原始核验结果或授权已不可用。' : '原会话来源已不可查看。')}</Text>
        {query.data.source.available && query.data.source.conversationId ? <Button secondary label="查看原会话" onPress={() => router.push({ pathname: '/chat', params: { conversationId: query.data!.source.conversationId } } as never)} /> : null}
        {query.data.source.available && query.data.source.executionId ? <Button secondary label="查看原始操作与验证" onPress={() => router.push({ pathname: '/executions/[id]', params: { id: query.data!.source.executionId! } } as never)} /> : null}
        {query.data.source.available && query.data.source.kind === 'REPORT_DECISION_CONFIRMED' ? <Button secondary label="查看决定对应的报告" onPress={() => router.push({ pathname: '/report', params: { conversationId: query.data!.source.conversationId!, messageId: query.data!.source.messageId! } } as never)} /> : null}
      </Card>
    </> : null}
  </EditorPage>;
}
