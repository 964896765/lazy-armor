import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, AnimatedEntry, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';

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

const popularTemplateKeys = [
  'quiet-delivery-guard',
  'monthly-bill-summary',
  'family-supply-reminder',
  'daily-important-summary',
  'video-multi-platform',
];

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
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={templates.isFetching} onRefresh={() => templates.refetch()} /> : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>你想偷掉哪件麻烦事？</Text>
          <Text style={styles.subtitle}>说一句就好，剩下的交给懒人装甲。</Text>
        </View>

        {!token ? <Surface><EmptyState icon="✨" title="登录后开始安排" description="告诉我一件麻烦事，我来帮你找办法。" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : (
          <>
            <Surface style={styles.composer}>
              <TextInput
                accessibilityLabel="描述你想交给懒人装甲的事情"
                style={styles.input}
                multiline
                numberOfLines={4}
                placeholder="例如：帮我管理车辆保养"
                placeholderTextColor={colors.textMuted}
                value={intent}
                onChangeText={(value) => { setIntent(value); parseIntent.reset(); }}
              />
              <ActionButton label={parseIntent.isPending ? '正在安排…' : '帮我安排'} onPress={() => parseIntent.mutate()} disabled={parseIntent.isPending || !intent.trim()} />
              {parseIntent.isError ? <Text style={styles.error}>我还没完全听懂。试着加上时间、条件或你希望得到的结果。</Text> : null}
            </Surface>

            {parseIntent.data ? (
              <AnimatedEntry>
                <Surface style={styles.suggestion}>
                  <Text style={styles.suggestionLabel}>为你找到一个合适的安排</Text>
                  <View style={styles.suggestionHeader}>
                    <View style={styles.templateIcon}><Text style={styles.templateEmoji}>{parseIntent.data.template.icon}</Text></View>
                    <View style={styles.suggestionCopy}><Text style={styles.templateName}>{parseIntent.data.template.name}</Text><Text style={styles.templateDescription}>{parseIntent.data.humanSummary}</Text></View>
                  </View>
                  {parseIntent.data.missingFields.length > 0 ? <Text style={styles.missing}>还需要你补充：{parseIntent.data.missingFields.map((field) => field.label).join('、')}</Text> : null}
                  <View style={styles.suggestionActions}>
                    <ActionButton label={parseIntent.data.canInstallDirectly ? '看看细节' : '继续设置'} tone="quiet" onPress={() => router.push(`/templates/${parseIntent.data?.template.key}?draft=${encodeURIComponent(JSON.stringify(parseIntent.data?.config))}` as never)} />
                    {parseIntent.data.canInstallDirectly ? <ActionButton label={installIntent.isPending ? '安排中…' : '就这样安排'} onPress={() => installIntent.mutate()} disabled={installIntent.isPending} /> : null}
                  </View>
                  {installIntent.isError ? <Text style={styles.error}>这次没有安排成功，请进入详情补充信息后再试。</Text> : null}
                </Surface>
              </AnimatedEntry>
            ) : null}

            <View style={styles.popularSection}>
              <Text style={styles.sectionTitle}>大家常交给我的事</Text>
              <Text style={styles.sectionSubtitle}>没有灵感时，从这里选一个。</Text>
              {templates.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
              {templates.isError ? <Text style={styles.error}>热门计划暂时没有加载出来，请稍后再试。</Text> : null}
              <View style={styles.templateGrid}>
                {popularTemplates.map((template) => (
                  <Pressable key={template.key} accessibilityRole="button" onPress={() => router.push(`/templates/${template.key}` as never)} style={({ pressed }) => [styles.templateCard, pressed && styles.pressed]}>
                    <Text style={styles.templateCardIcon}>{template.icon}</Text>
                    <Text style={styles.templateCardName}>{template.name}</Text>
                    <Text numberOfLines={2} style={styles.templateCardDescription}>{template.description}</Text>
                  </Pressable>
                ))}
              </View>
              {templates.data?.length === 0 ? <Surface><EmptyState icon="🌱" title="更多计划正在准备" description="你仍然可以在上面直接说出想做的事。" /></Surface> : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 112 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.display, color: colors.text, maxWidth: 330 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  composer: { padding: spacing.md },
  input: { ...typography.body, color: colors.text, minHeight: 118, textAlignVertical: 'top', padding: spacing.md, marginBottom: spacing.sm },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  suggestion: { marginTop: spacing.lg, borderColor: colors.accent },
  suggestionLabel: { ...typography.label, color: colors.success },
  suggestionHeader: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  templateIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  templateEmoji: { fontSize: 24 },
  suggestionCopy: { flex: 1 },
  templateName: { ...typography.cardTitle, color: colors.text },
  templateDescription: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  missing: { ...typography.caption, color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  suggestionActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  popularSection: { marginTop: spacing.xxxl },
  sectionTitle: { ...typography.section, color: colors.text },
  sectionSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
  loader: { marginVertical: spacing.xxl },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  templateCard: { width: '47.8%', minHeight: 158, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  templateCardIcon: { fontSize: 26 },
  templateCardName: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.md },
  templateCardDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
});
