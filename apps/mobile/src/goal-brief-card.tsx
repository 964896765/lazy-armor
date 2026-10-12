import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { authoringJobProjectionSchema, type AuthoringJobProjection } from '@lazy-armor/plan-schema/mobile';
import { presentGoalBrief, presentAuthoringJob } from './goal-experience-presenter';
import { Button, ui } from './editor-ui';
import { api } from './api';

export function GoalBriefCard({ value }: { value: unknown }) {
  const view = presentGoalBrief(value);
  if (!view) return null;
  return <View accessibilityLabel="目标与条件" style={{ gap: 6, paddingVertical: 10 }}>
    <Text style={ui.title}>我理解的目标</Text><Text selectable style={ui.label}>{view.title}</Text>
    {view.known.map(row => <Text key={row} style={ui.detail}>{row}</Text>)}
    {view.assumptions.length ? <><Text style={ui.label}>测算假设</Text>{view.assumptions.map(row => <Text key={row} style={ui.detail}>{row}</Text>)}</> : null}
    {view.questions.length ? <><Text style={ui.label}>需要补充</Text>{view.questions.map(row => <Text key={row} style={ui.detail}>{row}</Text>)}</> : null}
    {view.unknown.length ? <Text style={ui.detail}>尚未提供：{view.unknown.join('、')}</Text> : null}
  </View>;
}
export function AuthoringJobCard({ value, token, onStopped }: { value: unknown; token?: string; onStopped?: (conversationId: string) => Promise<void> }) {
  const view = presentAuthoringJob(value);
  const parsed = authoringJobProjectionSchema.safeParse(value);
  const stop = useMutation({
    mutationFn: async (job: AuthoringJobProjection) => {
      if (!token || !['QUEUED', 'RUNNING'].includes(job.status)) throw new Error('需求处理状态已变化，请刷新后继续');
      const result = authoringJobProjectionSchema.parse(await api<unknown>(`/authoring-jobs/${job.jobId}/cancel`, token, { method: 'POST' }));
      if (result.jobId !== job.jobId || result.conversationId !== job.conversationId) throw new Error('停止结果暂未核对，请刷新原需求');
      return result;
    },
    onSuccess: async result => { await onStopped?.(result.conversationId); },
  });
  if (!view) return null;
  return <View accessibilityLabel="需求处理进度" style={{ gap: 6, paddingVertical: 10 }}><Text style={ui.title}>{view.label}</Text>{view.pending ? <><Text style={ui.detail}>离开页面后继续整理，结果会保存在原需求中。</Text>{parsed.success && token && onStopped ? <Button secondary label={stop.isPending ? '正在停止本次需求处理…' : '停止本次需求处理'} disabled={stop.isPending} onPress={() => stop.mutate(parsed.data)} /> : null}<Text style={ui.detail}>停止本次需求整理后，可补充条件重新提出需求。</Text></> : view.failed ? <Text style={ui.detail}>原需求已保留，可核对条件后继续。</Text> : null}{stop.isError ? <Text style={ui.error}>未能确认停止结果，请重试或刷新原需求；已保存的条件仍保留。</Text> : null}</View>;
}
