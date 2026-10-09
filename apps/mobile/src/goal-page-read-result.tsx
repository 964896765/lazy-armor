import { Text } from 'react-native';
import { router } from 'expo-router';
import type { GoalPageReadResult } from '@lazy-armor/plan-schema/mobile';
import { Button, Card, ui } from './editor-ui';
import { ConsumerPresentationMapper as presentation } from './consumer-presentation';

export function GoalPageReadResultCard({ result, conversationId }: { result: GoalPageReadResult; conversationId: string }) {
  const labels: Record<GoalPageReadResult['status'], string> = {
    CONFIRMED: '范围已确认，等待本次读取', READING: '正在读取本次确认的页面字段', NEEDS_CONFIRMATION: '已读到线索，等待你核实',
    VERIFIED: '本次页面线索已核实', REJECTED: '你已拒绝本次线索', FAILED: '本次读取未完成', SOURCE_UNAVAILABLE: '来源、权限或核实依据已变化，请重新核对', SUPERSEDED: '原目标已更新，本次结果保留在历史记录',
  };
  return <Card title="本次页面读取"><Text style={ui.detail}>{labels[result.status]}</Text>
    {result.status === 'VERIFIED' ? result.verified.map(item => <Text key={item.versionId} selectable style={ui.detail}>计算器结果：{item.value} · 观察于 {presentation.dateTime(item.observedAt)}</Text>) : null}
    {result.status === 'NEEDS_CONFIRMATION' ? result.candidates.filter(item => item.status === 'PENDING').map(item => <Button key={item.id} secondary label="核实读取线索" onPress={() => router.push({ pathname: '/candidates/[id]', params: { id: item.id, returnConversationId: conversationId } } as never)} />) : null}
    {result.deviceTaskId ? <Button secondary label="查看本次读取记录" onPress={() => router.push(`/connections/device-tasks/${result.deviceTaskId}` as never)} /> : null}
  </Card>;
}
