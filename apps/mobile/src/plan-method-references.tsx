import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { api } from './api';
import { ui } from './editor-ui';
import { ConsumerPresentationMapper as p } from './consumer-presentation';
interface Reference { id: string; name: string; version: string; repositoryName: string; repositoryStatus: string }
export function PlanMethodReferences({ planId, token }: { planId: string; token: string | undefined }) {
  const query = useQuery({ queryKey: ['plan-methods', token, planId], queryFn: () => api<Reference[]>(`/plans/${planId}/methods`, token), enabled: Boolean(token && planId) });
  if (query.isError) return <Text style={ui.detail}>暂时无法读取方法依据</Text>;
  if (!query.data?.length) return null;
  return <View style={{ gap: 4 }}><Text style={ui.title}>规划时参考的方法</Text>{query.data.map(ref => <Text key={ref.id} style={ui.detail}>
    {p.text(ref.name, '方法')} · {ref.version} · {p.text(ref.repositoryName, '原方法仓库')}{ref.repositoryStatus === 'ARCHIVED' ? '（仓库已移出，保留原版本）' : ''}
  </Text>)}</View>;
}
