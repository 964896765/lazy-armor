import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
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
const creationSteps = ['来源', '触发', '判断', '执行', '确认'];
const quickIntents = ['帮我盯住快递变化', '每月整理账单', '车辆保养前提醒'];

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
        <WorkspaceHeader title="创建计划" subtitle="用自然语言，创建属于你的自动化计划" action={<Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={() => router.back()} style={styles.closeButton}><Ionicons name="close" size={24} color={colors.text} /></Pressable>} />
        <View style={styles.steps}>{creationSteps.map((label, index) => <View key={label} style={styles.stepItem}><View style={styles.stepTop}><View style={[styles.stepCircle, index === 0 && styles.stepCircleActive]}><Text style={[styles.stepNumber, index === 0 && styles.stepNumberActive]}>{index + 1}</Text></View>{index < creationSteps.length - 1 ? <View style={styles.stepLine} /> : null}</View><Text style={[styles.stepLabel, index === 0 && styles.stepLabelActive]}>{label}</Text></View>)}</View>

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="sparkles-outline" title="登录后开始安排" description="告诉我一件麻烦事，我来帮你找办法。" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : (
          <>
            <View style={styles.promptBlock}>
              <View style={styles.promptHeading}><Ionicons name="sparkles" size={20} color={colors.primary} /><Text style={styles.promptTitle}>用自然语言描述你的计划</Text></View>
              <View style={styles.composer}>
                <TextInput
                  accessibilityLabel="描述你想交给懒人装甲的事情"
                  style={styles.input}
                  multiline
                  numberOfLines={2}
                  placeholder="例如：每月 1 日检查上个月的话费账单，超过 500 元就提醒我并生成摘要。"
                  placeholderTextColor={colors.textMuted}
                  value={intent}
                  onChangeText={(value) => { setIntent(value); parseIntent.reset(); }}
                />
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: parseIntent.isPending || !intent.trim() }} disabled={parseIntent.isPending || !intent.trim()} onPress={() => parseIntent.mutate()} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, (parseIntent.isPending || !intent.trim()) && styles.disabled]}>{parseIntent.isPending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />}</Pressable>
              </View>
              <Text style={styles.quickLabel}>智能推荐</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>{quickIntents.map((item) => <Pressable key={item} onPress={() => { setIntent(item); parseIntent.reset(); }} style={styles.quickChip}><Ionicons name="add" size={16} color={colors.primary} /><Text style={styles.quickText}>{item}</Text></Pressable>)}</ScrollView>
              {parseIntent.isError ? <Text style={styles.error}>我还没完全听懂。试着加上时间、条件或想得到的结果。</Text> : null}
            </View>

            {parseIntent.data ? (
              <AnimatedEntry>
                <Surface style={styles.suggestion}>
                  <Text style={styles.suggestionLabel}>为你找到一个安排</Text>
                  <View style={styles.suggestionHeader}>
                    <View style={styles.templateIcon}><Ionicons name={planVisualIcon(parseIntent.data.template.name)} size={21} color={colors.primary} /></View>
                    <View style={styles.suggestionCopy}><Text style={styles.templateName}>{parseIntent.data.template.name}</Text><Text style={styles.templateDescription}>{parseIntent.data.humanSummary}</Text></View>
                  </View>
                  <View style={styles.draftRows}>
                    <DraftRow icon="server-outline" label="来源" value={parseIntent.data.adapter === 'template' ? '按模板所需来源连接' : '根据计划自动匹配'} />
                    <DraftRow icon="shield-checkmark-outline" label="风险" value="执行时按真实动作判断" />
                    <DraftRow icon="checkmark-circle-outline" label="确认" value={parseIntent.data.canInstallDirectly ? '草稿完整，可继续确认' : '补充信息后再确认'} last />
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
              {templates.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
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

function DraftRow({ icon, label, value, last = false }: { icon: 'server-outline' | 'shield-checkmark-outline' | 'checkmark-circle-outline'; label: string; value: string; last?: boolean }) {
  return <View style={[styles.draftRow, !last && styles.draftDivider]}><View style={styles.draftIcon}><Ionicons name={icon} size={17} color={colors.primary} /></View><Text style={styles.draftLabel}>{label}</Text><Text numberOfLines={1} style={styles.draftValue}>{value}</Text><Ionicons name="chevron-forward" size={15} color={colors.textMuted} /></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  closeButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  steps: { flexDirection: 'row', marginTop: spacing.md, paddingHorizontal: spacing.xs },
  stepItem: { flex: 1, alignItems: 'center' },
  stepTop: { width: '100%', flexDirection: 'row', alignItems: 'center' },
  stepCircle: { width: 28, height: 28, marginLeft: 'auto', borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9EDF2' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepNumber: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  stepNumberActive: { color: '#FFFFFF' },
  stepLine: { height: 1, flex: 1, backgroundColor: '#D8DEE7', marginRight: -1 },
  stepLabel: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  stepLabelActive: { color: colors.primary, fontWeight: '800' },
  stateSurface: { marginTop: spacing.xl },
  promptBlock: { marginTop: spacing.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#FFFFFF' },
  promptHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  promptTitle: { ...typography.section, color: colors.text },
  composer: { minHeight: 112, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, backgroundColor: '#F5F7FA', borderRadius: radius.md },
  input: { ...typography.body, color: colors.text, flex: 1, minHeight: 84, maxHeight: 124, textAlignVertical: 'top', paddingVertical: 0 },
  sendButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
  quickRow: { gap: spacing.sm, paddingTop: spacing.sm },
  quickChip: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  quickText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  suggestion: { marginTop: spacing.lg, borderColor: '#C7D7FE', padding: spacing.lg },
  suggestionLabel: { ...typography.label, color: colors.primary },
  suggestionHeader: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  templateIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  suggestionCopy: { flex: 1 },
  templateName: { ...typography.bodyStrong, color: colors.text },
  templateDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  missing: { ...typography.caption, color: '#B54708', backgroundColor: '#FFF4E5', borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  draftRows: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  draftRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  draftDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  draftIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  draftLabel: { ...typography.caption, color: colors.text, fontWeight: '700' },
  draftValue: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  suggestionActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  sectionSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  loader: { marginVertical: spacing.xl },
  templateList: { backgroundColor: '#FFFFFF' },
  quiet: { minHeight: 62, justifyContent: 'center', paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  quietText: { ...typography.caption, color: colors.textSecondary },
});
