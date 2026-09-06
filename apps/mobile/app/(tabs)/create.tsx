import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, AnimatedEntry, EmptyState, MessageRow, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';
import { planVisualIcon } from '../../src/plan-presenter';

interface PlanTemplateSummary {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  automationLevel: string;
  requiredConnectors: string[];
}

interface NaturalLanguageSuggestion {
  adapter: string;
  template: { key: string; name: string; description: string; icon: string };
  reason: string;
  config: Record<string, unknown>;
  humanSummary: string;
  canInstallDirectly: boolean;
  missingFields: Array<{ key: string; label: string }>;
  matchedKeywords: string[];
}

const popularTemplateKeys = ['quiet-delivery-guard', 'monthly-bill-summary', 'family-supply-reminder', 'daily-important-summary', 'video-multi-platform'];

export default function Create() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [intent, setIntent] = useState('');
  const templates = useQuery({ queryKey: ['templates', token], queryFn: () => api<PlanTemplateSummary[]>('/templates', token), enabled: Boolean(token) });
  const parseIntent = useMutation({
    mutationFn: () => api<NaturalLanguageSuggestion>('/templates/natural-language/parse', token, { method: 'POST', body: JSON.stringify({ query: intent.trim() }) }),
  });
  const installIntent = useMutation({
    mutationFn: () => api<{ id: string }>('/templates/natural-language/install', token, { method: 'POST', body: JSON.stringify({ query: intent.trim() }) }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['plans', token] });
      router.push(`/plans/${result.id}` as never);
    },
  });
  const popularTemplates = popularTemplateKeys
    .map((key) => templates.data?.find((template) => template.key === key))
    .filter((template): template is PlanTemplateSummary => Boolean(template));
  if (popularTemplates.length < 5) {
    for (const template of templates.data ?? []) {
      if (popularTemplates.length >= 5) break;
      if (!popularTemplates.some((item) => item.key === template.key)) popularTemplates.push(template);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor="#5865F2" refreshing={templates.isFetching} onRefresh={() => templates.refetch()} /> : undefined}>
        <WorkspaceHeader title="创建计划" subtitle="告诉我一件想省心的事" />

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="✨" title="登录后开始安排" description="告诉我一件麻烦事，我来帮你找办法。" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : (
          <>
            <View style={styles.promptBlock}>
              <Text style={styles.promptTitle}>你想偷掉哪件麻烦事？</Text>
              <View style={styles.composer}>
                <TextInput
                  accessibilityLabel="描述你想交给懒人装甲的事情"
                  style={styles.input}
                  multiline
                  numberOfLines={2}
                  placeholder="例如：帮我管理车辆保养"
                  placeholderTextColor={colors.textMuted}
                  value={intent}
                  onChangeText={(value) => { setIntent(value); parseIntent.reset(); }}
                />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: parseIntent.isPending || !intent.trim() }} disabled={parseIntent.isPending || !intent.trim()} onPress={() => parseIntent.mutate()} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, (parseIntent.isPending || !intent.trim()) && styles.disabled]}><Text style={styles.sendText}>{parseIntent.isPending ? '…' : '安排'}</Text></Pressable>
              </View>
              {parseIntent.isError ? <Text style={styles.error}>我还没完全听懂。试着加上时间、条件或想得到的结果。</Text> : null}
            </View>

            {parseIntent.data ? (
              <AnimatedEntry>
                <Surface style={styles.suggestion}>
                  <Text style={styles.suggestionLabel}>为你找到一个安排</Text>
                  <View style={styles.suggestionHeader}>
                    <View style={styles.templateIcon}><Text style={styles.templateEmoji}>{parseIntent.data.template.icon}</Text></View>
                    <View style={styles.suggestionCopy}><Text style={styles.templateName}>{parseIntent.data.template.name}</Text><Text style={styles.templateDescription}>{parseIntent.data.humanSummary}</Text></View>
                  </View>
                  {parseIntent.data.missingFields.length > 0 ? <Text style={styles.missing}>还需要补充：{parseIntent.data.missingFields.map((field) => field.label).join('、')}</Text> : null}
                  <View style={styles.suggestionActions}>
                    <ActionButton label={parseIntent.data.canInstallDirectly ? '查看细节' : '继续设置'} tone="quiet" onPress={() => router.push(`/templates/${parseIntent.data?.template.key}?draft=${encodeURIComponent(JSON.stringify(parseIntent.data?.config))}` as never)} />
                    {parseIntent.data.canInstallDirectly ? <ActionButton label={installIntent.isPending ? '安排中…' : '确认安排'} onPress={() => installIntent.mutate()} disabled={installIntent.isPending} /> : null}
                  </View>
                  {installIntent.isError ? <Text style={styles.error}>这次没有安排成功，请进入详情补充信息后再试。</Text> : null}
                </Surface>
              </AnimatedEntry>
            ) : null}

            <WorkspaceSection title="热门计划">
              <Text style={styles.sectionSubtitle}>没有灵感时，从真实可用的计划中选一个</Text>
              {templates.isLoading ? <ActivityIndicator color="#5865F2" style={styles.loader} /> : null}
              {templates.isError ? <Text style={styles.error}>热门计划暂时没有加载出来，请稍后再试。</Text> : null}
              {popularTemplates.length > 0 ? <View style={styles.templateList}>{popularTemplates.map((template, index) => <MessageRow key={template.key} icon={planVisualIcon(template.name)} title={template.name} description={template.description} tone="brand" onPress={() => router.push(`/templates/${template.key}` as never)} last={index === popularTemplates.length - 1} />)}</View> : null}
              {templates.data?.length === 0 ? <View style={styles.quiet}><Text style={styles.quietText}>更多计划正在准备，你仍然可以在上面直接说出想做的事。</Text></View> : null}
            </WorkspaceSection>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  stateSurface: { marginTop: spacing.xl },
  promptBlock: { marginTop: spacing.xl },
  promptTitle: { ...typography.section, color: colors.text, marginBottom: spacing.sm },
  composer: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#C7D7FE', borderRadius: 20 },
  input: { ...typography.body, color: colors.text, flex: 1, minHeight: 60, maxHeight: 92, textAlignVertical: 'center', paddingVertical: spacing.sm },
  sendButton: { minWidth: 50, height: 36, paddingHorizontal: spacing.sm, borderRadius: 12, backgroundColor: '#5865F2', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  suggestion: { marginTop: spacing.lg, borderColor: '#C7D7FE', padding: spacing.lg },
  suggestionLabel: { ...typography.label, color: '#5865F2' },
  suggestionHeader: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  templateIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  templateEmoji: { fontSize: 21 },
  suggestionCopy: { flex: 1 },
  templateName: { ...typography.bodyStrong, color: colors.text },
  templateDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  missing: { ...typography.caption, color: '#B54708', backgroundColor: '#FFF4E5', borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  suggestionActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  sectionSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  loader: { marginVertical: spacing.xl },
  templateList: { backgroundColor: '#FFFFFF' },
  quiet: { minHeight: 62, justifyContent: 'center', paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  quietText: { ...typography.caption, color: colors.textSecondary },
});
