import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import { agentReportSchema, reportTerminal } from '@lazy-armor/plan-schema/mobile';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { reportStageLabel } from '../src/agent-report-card';
export default function ReportPage() {
  const { conversationId, messageId } = useLocalSearchParams<{ conversationId: string; messageId: string }>();
  const token = useAuthStore(s => s.token); const [showPrompt, setShowPrompt] = useState(false);
  const query = useQuery({ queryKey: ['report', token, conversationId, messageId], enabled: Boolean(token && conversationId && messageId),
    queryFn: async () => { const conversation = await api<{ messages: Array<{ id: string; structuredPayload?: { report?: unknown } }> }>(`/conversations/${conversationId}`, token); return agentReportSchema.parse(conversation.messages.find(m => m.id === messageId)?.structuredPayload?.report); },
    refetchInterval: q => q.state.data && reportTerminal(q.state.data.stage) ? false : 3000 });
  const report = query.data;
  return <EditorPage title="报告">
    <Text style={ui.detail}>{report ? reportStageLabel[report.stage] : '读取生成任务'}</Text>
    <Button secondary label="返回原会话" onPress={() => router.push({ pathname: '/chat', params: { mode: 'temporary', conversationId } } as never)} />
    {query.isError ? <Button label="读取失败，重试" onPress={() => void query.refetch()} /> : null}
    {report ? <><Card title={report.plan?.title ?? '报告目标'}><Text selectable style={ui.detail}>{report.goal}</Text>{report.warnings.map((warning, i) => <Text key={i} style={ui.detail}>{warning}</Text>)}<Text style={ui.detail}>由 AI 生成和检查。来源响应与测算假设均需独立核实。</Text></Card>
      {report.plan ? <Card title="提示词与提纲"><Button secondary label={showPrompt ? '收起提示词' : '查看自动编写的提示词'} onPress={() => setShowPrompt(!showPrompt)} />{showPrompt ? <Text selectable style={ui.detail}>{report.plan.prompt}</Text> : null}{report.plan.sections.map(section => <Text key={section} style={ui.detail}>{section}</Text>)}{report.plan.assumptions.map((a, i) => <Text key={i} style={ui.detail}>假设：{a}</Text>)}</Card> : null}
      {report.markdown ? <Card title={report.stage === 'COMPLETED' ? '完整正文' : '尚未完成检查的草稿'}><Text selectable style={{ fontSize: 15, lineHeight: 25, color: '#27364B' }}>{report.markdown}</Text>{report.stage === 'COMPLETED' ? <Button label="分享报告文本" onPress={() => void Share.share({ title: report.plan?.title, message: report.markdown! })} /> : null}</Card> : null}
      {report.sources.length ? <Card title="本次资料来源">{report.sources.map(source => <View key={source.id}><Text style={ui.title}>[{source.id}] {source.label}</Text><Text style={ui.detail}>{source.provenance === 'SOURCE_RESPONSE_ONLY' ? '授权来源响应' : source.provenance === 'MODEL_ASSUMPTIONS_CALCULATED' ? 'AI 假设，程序计算，市场参数待核实' : '用户上传资料，未独立核实'} · {new Date(source.observedAt).toLocaleString('zh-CN')}</Text>{source.url ? <><Text selectable style={ui.detail}>{source.url}</Text><Text style={ui.detail}>发布日期：{source.publishedAt ?? '未取得'} · {source.retrievalMethod === 'SEARCH_RESULT' ? '搜索结果原文' : '从确认的网站入口取得原文'}</Text>{source.query ? <Text style={ui.detail}>检索词：{source.query}</Text> : null}<Button secondary label="打开来源原文" onPress={() => void Linking.openURL(source.url!)} /></> : null}</View>)}</Card> : null}
      {report.review ? <Card title="完整性与来源检查"><Text style={ui.detail}>{report.review.issues.length ? report.review.issues.join('\n') : '章节、引用及测算表达检查已完成；不代表市场事实已核实。'}</Text></Card> : null}
    </> : null}
  </EditorPage>;
}
