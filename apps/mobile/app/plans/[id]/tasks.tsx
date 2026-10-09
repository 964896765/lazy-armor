import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import type { TaskGraphProjection } from '@lazy-armor/plan-schema/mobile';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { EditorPage, Card, Button, ui } from '../../../src/editor-ui';
import { LoadingState, ErrorState, EmptyState } from '../../../src/consumer-ui';
import { taskDetail, taskGraphDetail } from '../../../src/task-presenter';
import { formatTime } from '../../../src/plan-presenter';

export default function PlanTasks() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore(state => state.token);
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({ queryKey: ['plan-tasks', id, cursor, token], enabled: Boolean(id && token),
    queryFn: () => api<{ items: TaskGraphProjection[]; nextCursor: string | null }>(`/plans/${id}/task-graphs?limit=10${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token),
    refetchInterval: data => data.state.data?.items.some(graph => ['CREATED', 'READY', 'RUNNING', 'WAITING', 'UNKNOWN'].includes(graph.status)) ? 5000 : false });
  return <EditorPage title="任务进度">
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? query.data.items.map(graph =>
      <Card key={graph.id} title={formatTime(graph.createdAt)} detail={taskGraphDetail(graph)}>
        {graph.planPaused ? <Text style={ui.detail}>计划已暂停，已开始的运行记录仍保留。</Text> : null}
        {graph.tasks.filter(task => task.executionStepId).map((task, index) => <View key={task.id} style={ui.listRow}>
          <Text style={ui.title}>{index + 1}. {task.title}</Text>
          <Text style={ui.detail}>{taskDetail(task)}{task.retryCount > 0 ? ` · 已重试 ${task.retryCount} 次` : ''}</Text>
        </View>)}
        <Button secondary label="查看运行结果" onPress={() => router.push(`/executions/${graph.executionId}` as never)} />
      </Card>) : <EmptyState title="还没有任务记录" detail="新的运行会在这里显示进度，既有运行可在运行记录中查看。" />}
    {query.data?.nextCursor ? <Button secondary label="下一页" onPress={() => setCursor(query.data!.nextCursor!)} /> : null}
    {cursor ? <Button secondary label="返回最近任务" onPress={() => setCursor(undefined)} /> : null}
  </EditorPage>;
}
