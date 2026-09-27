import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { AI_DEMO_NOTICE, buildAiResponse, type PlannerResultLike } from '../../src/search-presenter';

export default function SearchAiPage() {
  const token = useAuthStore((store) => store.token);
  const [aiQuery, setAiQuery] = useState('');

  const ask = useMutation({
    mutationFn: (input: string) => api<PlannerResultLike>('/templates/natural-language/agent', token, {
      method: 'POST',
      body: JSON.stringify({ query: input }),
    }),
  });
  const aiResponse = buildAiResponse(ask.data);
  const canJumpToWizard = aiResponse.kind === 'PLAN_DRAFT' && Boolean(aiResponse.scenarioKey);
  const submittedQuestion = ask.variables?.trim() ?? '';

  function submit() {
    const question = aiQuery.trim();
    if (!question || ask.isPending) return;
    ask.mutate(question);
    setAiQuery('');
  }

  function resetConversation() {
    ask.reset();
    setAiQuery('');
  }

  return <SafeAreaView edges={[]} style={styles.safeArea}><View style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>问一问 AI</Text><Text style={styles.subtitle}>帮你分析计划、解释结果并提供实用建议。</Text></View><Pressable accessibilityRole="button" onPress={resetConversation} style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}><Ionicons name="add-circle-outline" size={20} color={colors.text} /><Text style={styles.newChatText}>新对话</Text></Pressable></View>

      {!submittedQuestion && !ask.isPending ? <View style={styles.welcome}><View style={styles.aiAvatar}><Ionicons name="sparkles-outline" size={24} color={colors.primary} /></View><Text style={styles.welcomeTitle}>今天想了解什么？</Text><Text style={styles.welcomeText}>可以询问已有计划、执行结果，也可以描述一件想安排的事情。</Text></View> : null}
      {submittedQuestion ? <View style={styles.questionRow}><View style={styles.questionBubble}><Text style={styles.questionText}>{submittedQuestion}</Text></View><View style={styles.userAvatar}><Ionicons name="person-outline" size={20} color={colors.primary} /></View></View> : null}
      {ask.isPending ? <View style={styles.thinking}><View style={styles.botAvatar}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /></View><ActivityIndicator color={colors.primary} /><Text style={styles.thinkingText}>正在分析…</Text></View> : null}
      {ask.isError ? <View style={styles.aiCard}><Text style={styles.cardTitle}>AI 暂不可用</Text><Text style={styles.body}>当前没有取得服务端结果，请稍后再试。</Text></View> : null}
      {ask.data && !ask.isError ? <AiResultCard response={aiResponse} onJumpToWizard={canJumpToWizard ? () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(aiResponse.scenarioKey!)}` as never) : undefined} /> : null}
    </ScrollView>
    <View style={styles.composer}><Ionicons name="sparkles-outline" size={20} color={colors.text} /><TextInput value={aiQuery} onChangeText={setAiQuery} placeholder={submittedQuestion ? '继续问点什么' : '随便问点什么'} placeholderTextColor={colors.textMuted} style={styles.input} multiline maxLength={1000} /><Pressable accessibilityRole="button" accessibilityLabel="发送" disabled={!aiQuery.trim() || ask.isPending || !token} onPress={submit} style={[styles.send, (!aiQuery.trim() || ask.isPending || !token) && styles.sendDisabled]}><Ionicons name="send" size={18} color="#FFFFFF" /></Pressable></View>
  </View></SafeAreaView>;
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1 }, content: { padding: spacing.lg, paddingBottom: spacing.xxl }, pressed: { opacity: 0.68 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md }, headerCopy: { flex: 1, minWidth: 0 }, title: { ...typography.display, color: colors.text, fontSize: 27, lineHeight: 35 }, subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.xs }, newChat: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, newChatText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  welcome: { alignItems: 'center', marginTop: 72, paddingHorizontal: spacing.xl }, aiAvatar: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.accentSoft }, welcomeTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, welcomeText: { ...typography.body, color: colors.textSecondary, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm },
  questionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl }, questionBubble: { maxWidth: '82%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 18, backgroundColor: '#E4F1EB' }, questionText: { ...typography.bodyStrong, color: colors.text, lineHeight: 22 }, userAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#EFEEEA' },
  thinking: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, botAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.accentSoft }, thinkingText: { ...typography.caption, color: colors.textSecondary },
  composer: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingLeft: spacing.md, paddingRight: 5, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#F0EFEB', borderWidth: 1, borderColor: colors.border }, input: { ...typography.body, color: colors.text, flex: 1, maxHeight: 92, paddingVertical: 7 }, send: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.primary }, sendDisabled: { backgroundColor: '#B4B5B2' },
  askButton: { minHeight: 46, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, askButtonDisabled: { backgroundColor: colors.textMuted }, askButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  aiCard: { alignItems: 'flex-start', marginTop: spacing.lg, marginLeft: 48, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#615B53', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 }, aiIcon: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.md },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.sm }, missingBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignSelf: 'stretch' }, missingItem: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  demoNotice: { fontSize: 10, lineHeight: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
