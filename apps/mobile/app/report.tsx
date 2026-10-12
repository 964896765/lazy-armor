import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import { agentReportSchema, reportFailureExplanation, reportTerminal, conversationGenerationOutcome, type ReportMethodRun } from '@lazy-armor/plan-schema/mobile';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { compositionFieldLabel } from '../src/composition-presenter';
import { ReportDecisionPanel } from '../src/report-decision-panel';
export default function ReportPage() {
  const { conversationId, messageId } = useLocalSearchParams<{ conversationId: string; messageId: string }>();
  const token = useAuthStore(s => s.token); const [showPrompt, setShowPrompt] = useState(false);
  const query = useQuery({ queryKey: ['report', token, conversationId, messageId], enabled: Boolean(token && conversationId && messageId),
    queryFn: async () => { const conversation = await api<{ mode: 'TEMPORARY' | 'PLAN'; messages: Array<{ id: string; structuredPayload?: { report?: unknown } }> }>(`/conversations/${conversationId}`, token); if (!['TEMPORARY', 'PLAN'].includes(conversation.mode)) throw new Error('原需求上下文暂不可用'); return { mode: conversation.mode, report: agentReportSchema.parse(conversation.messages.find(m => m.id === messageId)?.structuredPayload?.report) }; },
    refetchInterval: q => q.state.data && reportTerminal(q.state.data.report.stage) ? false : 3000 });
  const report = query.data?.report;
  const outcome = report ? conversationGenerationOutcome('ANSWER', report) : null;
  return <EditorPage title="报告">
    <Text style={ui.detail}>{outcome?.status ?? '读取生成任务'}</Text>
    <Button secondary label="返回原会话" disabled={!query.data} onPress={() => router.push({ pathname: '/chat', params: { mode: query.data?.mode === 'PLAN' ? 'plan' : 'temporary', conversationId } } as never)} />
    {query.isError ? <Button label="读取失败，重试" onPress={() => void query.refetch()} /> : null}
    {report?.stage === 'FAILED' && reportFailureExplanation(report.errorCode) ? <Text style={ui.error}>{reportFailureExplanation(report.errorCode)}</Text> : null}
    {report ? <><Card title={report.plan?.title ?? '报告目标'}><Text selectable style={ui.detail}>{report.goal}</Text>{report.warnings.map((warning, i) => <Text key={i} style={ui.detail}>{warning}</Text>)}<Text style={ui.detail}>由 AI 生成和检查。来源响应与测算假设均需独立核实。</Text></Card>
      {report.plan ? <Card title="提示词与提纲"><Button secondary label={showPrompt ? '收起提示词' : '查看自动编写的提示词'} onPress={() => setShowPrompt(!showPrompt)} />{showPrompt ? <Text selectable style={ui.detail}>{report.plan.prompt}</Text> : null}{report.plan.sections.map(section => <Text key={section} style={ui.detail}>{section}</Text>)}{report.plan.assumptions.map((a, i) => <Text key={i} style={ui.detail}>假设：{a}</Text>)}</Card> : null}
      {report.requirementContext?.composition ? <Card title="本次报告使用的方法">{report.requirementContext.composition.methods.map((method, index) => <Text key={method.ref.entryId} style={ui.detail}>{index + 1}. {method.manifest.name} · {method.manifest.version}</Text>)}<Text style={ui.detail}>已选方法用于整理报告提示词、正文和检查。交付成果：</Text>{report.requirementContext.composition.snapshot.selection.graph.deliveries.map((delivery, index) => <Text key={index} style={ui.detail}>{delivery.label}</Text>)}{report.requirementContext.composition.snapshot.reportReadBindings?.map(binding => <Button key={`${binding.methodId}:${binding.capabilityKey}`} secondary label={`查看固定${binding.capabilityKey === 'READ_PUBLIC_WEB_RESEARCH' ? '网页' : '接口'}来源范围`} onPress={() => router.push({ pathname: binding.capabilityKey === 'READ_PUBLIC_WEB_RESEARCH' ? '/public-web-resource' : '/interface-detail', params: { id: binding.connectionId } } as never)} />)}<Text style={ui.detail}>{report.requirementContext.composition.adapter === 'REPORT_METHOD_CHAIN_V1' ? '逐项生成方法成果并检查字段与引用；模型分析内容仍需核实。' : '当前为报告写作参考，方法之间的独立输出尚未执行验证。'}</Text></Card> : null}
      {report.methodRuns?.map((run, index) => <MethodResult key={run.methodRef.entryId} run={run} title={`${index + 1}. ${report.requirementContext?.composition?.methods.find(method => method.ref.entryId === run.methodRef.entryId)?.manifest.name ?? '方法成果'}`} />)}
      {report.budget ? <Card title="本次生成用量"><Text style={ui.detail}>模型请求：{report.budget.modelCalls} / {report.budget.maxModelCalls}</Text><Text style={ui.detail}>任务截止：{new Date(report.budget.deadlineAt).toLocaleString('zh-CN')}</Text><Text style={ui.detail}>已取得的模型用量：{report.budget.observedTotalTokens} tokens（{report.budget.usageResponses} 次响应提供用量）。费用尚未计价。</Text></Card> : null}
      {report.markdown ? <Card title={report.stage === 'COMPLETED' ? '完整正文' : '尚未完成检查的草稿'}><Text selectable style={{ fontSize: 15, lineHeight: 25, color: '#27364B' }}>{report.markdown}</Text>{report.stage === 'COMPLETED' ? <Button label="分享报告文本" onPress={() => void Share.share({ title: report.plan?.title, message: report.markdown! })} /> : null}</Card> : null}
      {report.sources.length ? <Card title="本次资料来源">{report.sources.map(source => <View key={source.id}><Text style={ui.title}>[{source.id}] {source.label}</Text><Text style={ui.detail}>{source.provenance === 'SOURCE_RESPONSE_ONLY' ? '授权来源响应' : source.provenance === 'MODEL_ASSUMPTIONS_CALCULATED' ? 'AI 假设，程序计算，市场参数待核实' : '用户上传资料，未独立核实'} · {new Date(source.observedAt).toLocaleString('zh-CN')}</Text>{source.url ? <><Text selectable style={ui.detail}>{source.url}</Text><Text style={ui.detail}>发布日期：{source.publishedAt ?? '未取得'} · {source.retrievalMethod === 'SEARCH_RESULT' ? '搜索结果原文' : '从确认的网站入口取得原文'}</Text>{source.query ? <Text style={ui.detail}>检索词：{source.query}</Text> : null}<Button secondary label="打开来源原文" onPress={() => void Linking.openURL(source.url!)} /></> : null}</View>)}</Card> : null}
      {report.review ? <Card title="完整性与来源检查"><Text style={ui.detail}>{report.review.issues.length ? report.review.issues.join('\n') : '章节、引用及测算表达检查已完成；不代表市场事实已核实。'}</Text></Card> : null}
      {report.stage === 'COMPLETED' ? <ReportDecisionPanel token={token} conversationId={conversationId} messageId={messageId} /> : null}
    </> : null}
  </EditorPage>;
}

function MethodResult({ run, title }: { run: ReportMethodRun; title: string }) {
  const [showInputs, setShowInputs] = useState(false);
  return <Card title={title}><Text style={ui.detail}>字段与引用校验已完成，内容为 AI 分析产物，尚需独立核实。</Text>
    <Button secondary label={showInputs ? '收起本次输入' : '查看本次实际输入'} onPress={() => setShowInputs(!showInputs)} />
    {showInputs ? Object.entries(run.inputs).map(([key, value]) => <View key={key}><Text style={ui.label}>{compositionFieldLabel(key)}</Text><Text selectable style={ui.detail}>{String(value)}</Text></View>) : null}
    {Object.entries(run.outputs).map(([key, value]) => <View key={key}><Text style={ui.label}>成果：{compositionFieldLabel(key)}</Text><Text selectable style={ui.detail}>{String(value)}</Text></View>)}
    <Text style={ui.detail}>使用资料：{run.sourceIds.length ? run.sourceIds.join('、') : '没有引用原文，按本次输入分析'}</Text>
  </Card>;
}
