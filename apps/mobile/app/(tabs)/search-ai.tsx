import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import {
  AI_DEMO_NOTICE,
  buildAiResponse,
  buildSearchSections,
  type PlannerResultLike,
  type SearchResults,
} from '../../src/search-presenter';

export default function SearchAiPage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<'search' | 'ai'>('search');
  const [query, setQuery] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const needle = query.trim();

  const search = useQuery({
    queryKey: ['search', token, needle],
    queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(needle)}`, token),
    enabled: Boolean(token && needle && mode === 'search'),
  });
  const sections = buildSearchSections(search.data);

  const ask = useMutation({
    mutationFn: (input: string) => api<PlannerResultLike>('/templates/natural-language/agent', token, {
      method: 'POST',
      body: JSON.stringify({ query: input }),
    }),
  });
  const aiResponse = buildAiResponse(ask.data);
  const canJumpToWizard = aiResponse.kind === 'PLAN_DRAFT' && Boolean(aiResponse.scenarioKey);

  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>搜索与万事问</Text>
    <View style={styles.modes}><Mode label="搜索" selected={mode === 'search'} onPress={() => setMode('search')} /><Mode label="问万事问" selected={mode === 'ai'} onPress={() => setMode('ai')} /></View>
    {mode === 'search' ? <>
      <View style={styles.search}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={query} onChangeText={setQuery} placeholder="搜索计划、场景、记录或消息" placeholderTextColor={colors.textMuted} style={styles.input} /></View>
      <Text style={styles.boundary}>搜索词仅用于在服务端匹配本人数据，不会发送给模型。</Text>
      {needle ? search.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : search.isError ? <Text style={styles.error}>搜索暂时不可用，请稍后重试。</Text> : sections.length === 0 ? <Text style={styles.empty}>没有匹配结果</Text> : sections.map((section) => <ResultSection key={section.key} title={section.title}>{section.rows.map((row) => <Result key={row.id} label={row.title} meta={row.subtitle || undefined} onPress={() => router.push(row.route as never)} />)}</ResultSection>) : null}
    </> : <View>
      <View style={styles.search}><TextInput value={aiQuery} onChangeText={setAiQuery} placeholder="告诉万事问你想做什么" placeholderTextColor={colors.textMuted} style={styles.input} multiline /></View>
      <Pressable accessibilityRole="button" disabled={!aiQuery.trim() || ask.isPending} onPress={() => ask.mutate(aiQuery.trim())} style={[styles.askButton, (!aiQuery.trim() || ask.isPending) && styles.askButtonDisabled]}><Text style={styles.askButtonText}>{ask.isPending ? '正在演示规划…' : '问万事问'}</Text></Pressable>
      <Text style={styles.boundary}>{AI_DEMO_NOTICE}。切换到此模式后才会调用演示规划，输出不会冒充真实规划结果，也不会执行、授权或支付。</Text>
      {ask.isPending ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
      {ask.isError ? <View style={styles.aiCard}><Text style={styles.cardTitle}>AI 暂不可用</Text><Text style={styles.body}>演示规划暂时无法返回结果，不会用本地内容冒充。</Text></View> : null}
      {ask.data && !ask.isError ? <AiResultCard response={aiResponse} onJumpToWizard={canJumpToWizard ? () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(aiResponse.scenarioKey!)}` as never) : undefined} /> : null}
    </View>}
  </ScrollView></SafeAreaView>;
}

function AiResultCard({ response, onJumpToWizard }: { response: ReturnType<typeof buildAiResponse>; onJumpToWizard?: () => void }) {
  return <View style={styles.aiCard}>
    <View style={styles.aiIcon}><Ionicons name="sparkles-outline" size={24} color={colors.primary} /></View>
    <Text style={styles.cardTitle}>{response.title}</Text>
    {response.body ? <Text style={styles.body}>{response.body}</Text> : null}
    {response.missingRequirements.length > 0 ? <View style={styles.missingBox}>{response.missingRequirements.map((item) => <Text key={item} style={styles.missingItem}>· {item}</Text>)}</View> : null}
    {onJumpToWizard ? <Pressable accessibilityRole="button" onPress={onJumpToWizard} style={styles.askButton}><Text style={styles.askButtonText}>去创建向导继续</Text></Pressable> : null}
    <Text style={styles.demoNotice}>{AI_DEMO_NOTICE}</Text>
  </View>;
}

function Mode({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.mode, selected && styles.modeSelected]}><Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text></Pressable>; }
function ResultSection({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.results}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function Result({ label, meta, onPress }: { label: string; meta?: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.result, pressed && styles.pressed]}><View style={styles.resultCopy}><Text numberOfLines={1} style={styles.resultText}>{label}</Text>{meta ? <Text numberOfLines={1} style={styles.resultMeta}>{meta}</Text> : null}</View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>; }
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, paddingBottom: spacing.xxl }, title: { ...typography.title, color: colors.text, marginTop: spacing.md },
  modes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }, mode: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: '#EFEEEA' }, modeSelected: { backgroundColor: colors.primary }, modeText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' }, modeTextSelected: { color: '#FFFFFF' },
  search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, input: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 0 },
  boundary: { fontSize: 10, lineHeight: 16, color: colors.textMuted, marginTop: spacing.sm }, loading: { marginTop: spacing.lg }, error: { ...typography.caption, color: colors.danger, marginTop: spacing.lg }, empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md, marginTop: spacing.lg },
  results: { marginTop: spacing.lg }, sectionTitle: { ...typography.section, color: colors.text, marginBottom: spacing.xs },
  result: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, resultCopy: { flex: 1, minWidth: 0 }, resultText: { ...typography.body, color: colors.text }, resultMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 }, pressed: { backgroundColor: colors.pressed },
  askButton: { minHeight: 46, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, askButtonDisabled: { backgroundColor: colors.textMuted }, askButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  aiCard: { alignItems: 'center', marginTop: spacing.lg, padding: spacing.xxl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, aiIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginTop: spacing.sm }, missingBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignSelf: 'stretch' }, missingItem: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  demoNotice: { fontSize: 10, lineHeight: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
