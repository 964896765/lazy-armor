import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { MessageRow } from '../../src/design';
import { planVisualIcon } from '../../src/plan-presenter';
import { LoginRequired, RuntimeDetailScreen, RuntimeLoadState } from '../../src/runtime-details-ui';

interface TemplateSummary {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  templateVersion: string;
  status: 'published';
  automationLevel: string;
  requiredConnectors: string[];
}

export default function TemplatesIndexPage() {
  const token = useAuthStore((store) => store.token);
  const templates = useQuery({ queryKey: ['templates', token], queryFn: () => api<TemplateSummary[]>('/templates', token), enabled: Boolean(token) });
  return <RuntimeDetailScreen title="模板目录" subtitle="来自当前发布目录；不展示示例或未发布模板">
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={templates.isLoading} error={templates.isError} empty={!templates.isLoading && !templates.isError && (templates.data?.length ?? 0) === 0} onRetry={() => templates.refetch()} loadingText="正在读取模板目录…" emptyTitle="没有已发布模板" /> : null}
    <View>{templates.data?.map((template, index, all) => <MessageRow key={template.key} icon={planVisualIcon(template.name)} title={template.name} description={`${template.description} · ${template.automationLevel}`} meta={`v${template.templateVersion}`} tone="brand" onPress={() => router.push(`/templates/${template.key}` as never)} last={index === all.length - 1} />)}</View>
  </RuntimeDetailScreen>;
}
