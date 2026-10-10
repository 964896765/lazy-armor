import type { ConversationMethodProjection } from '@lazy-armor/plan-schema/mobile';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, ui } from './editor-ui';
import { ConsumerPresentationMapper as p } from './consumer-presentation';

export function ConversationMethods({ methods }: { methods?: ConversationMethodProjection[] }) {
  if (!methods?.length) return null;
  return <Card title="你选择的规划方法">{methods.map(method => <Card key={method.ref.revisionId}
    title={p.text(method.name)} detail={`${p.text(method.repositoryName)}${method.version ? ' · ' + p.text(method.version) : ''}`}>
    <Text style={ui.detail}>{method.state === 'CURRENT' ? '本会话参考你选择的这个版本。实际资源、权限与执行仍需独立核对。'
      : method.state === 'CHANGED' ? '方法已更新，本会话保留原版本。请回到仓库重新选择后开始会话。'
        : '方法已关闭或移出，原引用保留。请回到仓库核对并重新选择。'}</Text>
    <Button secondary label="查看方法仓库" onPress={() => router.push(`/skill-repositories/${method.ref.repositoryId}` as never)} />
  </Card>)}</Card>;
}
