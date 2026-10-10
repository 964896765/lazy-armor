import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { agentReportSchema, reportTerminal } from '@lazy-armor/plan-schema/mobile';
import { Button, ui } from './editor-ui';
export const reportStageLabel = { QUEUED: '等待生成', PLANNING: '正在整理提示词与提纲', RESEARCHING: '正在读取授权资料', WRITING: '正在生成正文', REVIEWING: '正在检查与修订', COMPLETED: '报告已生成', FAILED: '本次报告未完成', SUPERSEDED: '报告目标已更新' };
export function AgentReportCard({ value, conversationId, messageId }: { value: unknown; conversationId: string; messageId: string }) {
  const parsed = agentReportSchema.safeParse(value); if (!parsed.success) return null;
  const report = parsed.data;
  return <View style={{ gap: 8 }}><Text style={ui.title}>{report.plan?.title ?? '自主报告生成'}</Text><Text style={ui.detail}>{reportStageLabel[report.stage]}</Text>
    {!reportTerminal(report.stage) ? <Text style={ui.detail}>离开页面后继续生成，完成后可回到此会话查看。</Text> : null}
    {report.warnings.map((warning, i) => <Text key={i} style={ui.detail}>{warning}</Text>)}
    <Button secondary label={report.stage === 'COMPLETED' ? '查看完整报告' : '查看生成进度与提示词'} onPress={() => router.push({ pathname: '/report', params: { conversationId, messageId } } as never)} />
  </View>;
}
