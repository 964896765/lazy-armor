import type { ResourceRequirementProjection } from '@lazy-armor/plan-schema/mobile';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, ui } from './editor-ui';
import { ConsumerPresentationMapper as p } from './consumer-presentation';
import { riskLevelLabel } from './today-presenter';

export function ResourceRequirements({ requirements, conversationId, workContext }: {
  requirements: ResourceRequirementProjection[]; conversationId: string; workContext?: 'TEMPORARY' | 'PLAN';
}) {
  return <>{requirements.map((need, index) => <Card key={index} title={p.capability(need.key)}>
    {need.reasons.map((reason, i) => <Text key={i} style={ui.detail}>{p.reason(reason)}</Text>)}
    {need.resources.map(resource => <Card key={resource.resourceId} title={p.text(resource.name, '所需资源')}>
      <Text style={ui.detail}>{({ READY: '资源已就绪', UNAVAILABLE: '需要补充或恢复', NEEDS_SELECTION: '需要选择来源' })[resource.state]}</Text>
      {resource.riskLevel ? <Text style={ui.detail}>资源操作风险：{riskLevelLabel(resource.riskLevel)}</Text> : null}
      {resource.operation === 'execute' ? <Text style={ui.detail}>实际操作继续按原执行政策确认与审批。</Text> : null}
      {resource.reasons.map((reason, i) => <Text key={i} style={ui.detail}>{p.reason(reason)}</Text>)}
      <Button secondary label={resource.action.label} onPress={() => router.push(resource.action.path as never)} />
    </Card>)}
    {!need.resources.length ? <Button secondary label="查看资源" onPress={() => router.push({ pathname: '/resources',
      params: { returnConversationId: conversationId, ...(workContext ? { returnMode: workContext === 'PLAN' ? 'plan' : 'temporary' } : {}) } } as never)} /> : null}
  </Card>)}</>;
}
