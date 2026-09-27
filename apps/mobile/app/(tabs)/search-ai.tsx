import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { cancelSystemSpeechRecognition, startSystemSpeechRecognition } from '../../src/device-app-bridge';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { AI_DEMO_NOTICE, buildAiResponse, type PlannerResultLike } from '../../src/search-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];
type AiPrompt = { display: string; query: string };
type LocalAttachment = { name: string; excerpt: string; size: number };

export default function SearchAiPage() {
  const token = useAuthStore((store) => store.token);
  const [aiQuery, setAiQuery] = useState('');
  const [voicePending, setVoicePending] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(true);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  const voiceCancelled = useRef(false);
  const inputRef = useRef<TextInput>(null);

  useFocusEffect(useCallback(() => {
    setComposerExpanded(true);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(focusTimer);
  }, []));

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const overlap = Dimensions.get('window').height - event.endCoordinates.screenY;
      setKeyboardOverlap(Math.max(0, Math.min(overlap, 480)));
      setComposerExpanded(true);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOverlap(0);
      setComposerExpanded(false);
    });
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  const ask = useMutation({
    mutationFn: (input: AiPrompt) => api<PlannerResultLike>('/templates/natural-language/agent', token, {
      method: 'POST',
      body: JSON.stringify({ query: input.query }),
    }),
  });
  const aiResponse = buildAiResponse(ask.data);
  const canJumpToWizard = aiResponse.kind === 'PLAN_DRAFT' && Boolean(aiResponse.scenarioKey);
  const submittedQuestion = ask.variables?.display.trim() ?? '';

  function submit() {
    const question = aiQuery.trim();
    if (!question || ask.isPending) return;
    const context = attachment ? `\n\n用户选择的本地资料《${attachment.name}》摘录：\n${attachment.excerpt}` : '';
    ask.mutate({ display: question, query: `${question}${context}`.slice(0, 500) });
    setAiQuery('');
    setAttachment(null);
  }

  function resetConversation() {
    ask.reset();
    setAiQuery('');
  }

  async function startVoiceInput() {
    if (voicePending) return;
    Keyboard.dismiss();
    setComposerExpanded(true);
    voiceCancelled.current = false;
    setVoicePending(true);
    setVoiceOpen(true);
    setVoiceError(null);
    const transcript = await startSystemSpeechRecognition('zh-CN');
    setVoicePending(false);
    setVoiceOpen(false);
    if (voiceCancelled.current) return;
    if (!transcript) {
      setVoiceError('没有听清，请检查麦克风权限后重试。');
      return;
    }
    setAiQuery((current) => `${current}${current.trim() ? ' ' : ''}${transcript}`);
  }

  async function cancelVoiceInput() {
    voiceCancelled.current = true;
    await cancelSystemSpeechRecognition();
    setVoicePending(false);
    setVoiceOpen(false);
  }

  async function pickLocalFile() {
    setAttachmentMenuOpen(false);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/plain', 'text/csv', 'application/json'], copyToCacheDirectory: true, multiple: false,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset || (asset.size ?? 0) > 500_000) {
      setVoiceError('资料需为不超过 500 KB 的 TXT、CSV 或 JSON 文件。');
      return;
    }
    try {
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const excerpt = content.replace(/\s+/g, ' ').trim().slice(0, 260);
      if (!excerpt) throw new Error('EMPTY_FILE');
      setAttachment({ name: asset.name.slice(0, 80), excerpt, size: asset.size ?? content.length });
      setVoiceError(null);
    } catch {
      setVoiceError('没有读取到可用于提问的文字内容。');
    }
  }

  return <SafeAreaView edges={[]} style={styles.safeArea}><KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Pressable style={styles.conversation} onPress={Keyboard.dismiss} accessible={false}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="never" keyboardDismissMode="on-drag">
      <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>问一问 AI</Text><Text style={styles.subtitle}>帮你分析计划、解释结果并提供实用建议。</Text></View><Pressable accessibilityRole="button" onPress={resetConversation} style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}><Ionicons name="add-circle-outline" size={20} color={colors.text} /><Text style={styles.newChatText}>新对话</Text></Pressable></View>

      {!submittedQuestion && !ask.isPending ? <View style={styles.welcome}><View style={styles.aiAvatar}><Ionicons name="sparkles-outline" size={24} color={colors.primary} /></View><Text style={styles.welcomeTitle}>今天想了解什么？</Text><Text style={styles.welcomeText}>可以询问已有计划、执行结果，也可以描述一件想安排的事情。</Text></View> : null}
      {submittedQuestion ? <View style={styles.questionRow}><View style={styles.questionBubble}><Text style={styles.questionText}>{submittedQuestion}</Text></View><View style={styles.userAvatar}><Ionicons name="person-outline" size={20} color={colors.primary} /></View></View> : null}
      {ask.isPending ? <View style={styles.thinking}><View style={styles.botAvatar}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /></View><ActivityIndicator color={colors.primary} /><Text style={styles.thinkingText}>正在分析…</Text></View> : null}
      {ask.isError ? <View style={styles.aiCard}><Text style={styles.cardTitle}>AI 暂不可用</Text><Text style={styles.body}>当前没有取得服务端结果，请稍后再试。</Text></View> : null}
      {ask.data && !ask.isError ? <AiResultCard response={aiResponse} onJumpToWizard={canJumpToWizard ? () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(aiResponse.scenarioKey!)}` as never) : undefined} /> : null}
    </ScrollView></Pressable>
    <SafeAreaView edges={['bottom']} style={[styles.bottomSafe, Platform.OS === 'android' && keyboardOverlap > 0 ? { marginBottom: keyboardOverlap } : null]}>{voiceError ? <Text style={styles.voiceError}>{voiceError}</Text> : null}{attachment ? <View style={styles.attachmentChip}><Ionicons name="document-text-outline" size={15} color={colors.primary} /><Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="移除资料" onPress={() => setAttachment(null)} hitSlop={8}><Ionicons name="close" size={17} color={colors.textSecondary} /></Pressable></View> : null}<View style={[styles.bottomRow, composerExpanded && styles.bottomRowExpanded]}>
      <View style={[styles.composer, composerExpanded && styles.composerExpanded]}>
        <View style={styles.composerInputRow}>{!composerExpanded ? <Pressable accessibilityRole="button" accessibilityLabel="添加资料" onPress={() => setAttachmentMenuOpen(true)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Ionicons name="add" size={23} color={colors.textSecondary} /></Pressable> : null}<TextInput ref={inputRef} value={aiQuery} onFocus={() => setComposerExpanded(true)} onChangeText={(value) => { setAiQuery(value); setVoiceError(null); }} placeholder={submittedQuestion ? '继续问点什么' : '随便问点什么'} placeholderTextColor={colors.textMuted} style={styles.input} multiline={composerExpanded} maxLength={500} />{!composerExpanded ? <Pressable accessibilityRole="button" accessibilityLabel="发送" disabled={!aiQuery.trim() || ask.isPending || !token} onPress={submit} style={[styles.send, (!aiQuery.trim() || ask.isPending || !token) && styles.sendDisabled]}><Ionicons name="arrow-up" size={22} color="#FFFFFF" /></Pressable> : null}
        </View>
        {composerExpanded ? <View style={styles.composerToolsRow}><Pressable accessibilityRole="button" accessibilityLabel="添加资料" onPress={() => { Keyboard.dismiss(); setAttachmentMenuOpen(true); }} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Ionicons name="add" size={23} color={colors.textSecondary} /></Pressable><ComposerActions voicePending={voicePending} canSend={Boolean(aiQuery.trim() && !ask.isPending && token)} onVoice={startVoiceInput} onSend={submit} /></View> : null}
      </View>
    </View></SafeAreaView>
    <AttachmentSheet open={attachmentMenuOpen} onClose={() => setAttachmentMenuOpen(false)} onPickFile={() => void pickLocalFile()} />
    <VoiceOverlay open={voiceOpen} onCancel={() => void cancelVoiceInput()} />
  </KeyboardAvoidingView></SafeAreaView>;
}

function AttachmentSheet({ open, onClose, onPickFile }: { open: boolean; onClose: () => void; onPickFile: () => void }) {
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.modalBackdrop} onPress={onClose}><Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
    <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>添加资料</Text><Text style={styles.sheetHint}>资料只在你明确选择后用于本次提问</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={23} color={colors.text} /></Pressable></View>
    <SheetAction icon="document-text-outline" title="文件" detail="读取 TXT、CSV 或 JSON 的文字摘录" onPress={onPickFile} />
    <SheetAction icon="link-outline" title="已连接的信息源" detail="前往连接中心选择已授权来源" onPress={() => { onClose(); router.push('/connections' as never); }} />
    <SheetAction icon="image-outline" title="照片" detail="图片理解接口尚未接入" disabled />
    <SheetAction icon="camera-outline" title="摄像头" detail="拍摄与图像理解尚未接入" disabled />
  </Pressable></Pressable></Modal>;
}

function SheetAction({ icon, title, detail, onPress, disabled = false }: { icon: IconName; title: string; detail: string; onPress?: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.sheetAction, disabled && styles.sheetActionDisabled, pressed && styles.pressed]}><View style={styles.sheetActionIcon}><Ionicons name={icon} size={22} color={disabled ? colors.textMuted : colors.primary} /></View><View style={styles.sheetActionCopy}><Text style={styles.sheetActionTitle}>{title}</Text><Text style={styles.sheetActionDetail}>{detail}</Text></View>{disabled ? <Text style={styles.pendingBadge}>待接入</Text> : <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />}</Pressable>;
}

function VoiceOverlay({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}><View style={styles.voiceBackdrop}><View style={styles.voiceCard}><View style={styles.voiceOrb}><Ionicons name="mic" size={34} color="#FFFFFF" /></View><Text style={styles.voiceTitle}>正在听</Text><Text style={styles.voiceHint}>说出你想问的内容，停顿后会自动填写</Text><View style={styles.voiceBars}>{[20, 34, 48, 30, 42].map((height, index) => <View key={index} style={[styles.voiceBar, { height }]} />)}</View><Pressable accessibilityRole="button" onPress={onCancel} style={styles.voiceCancel}><Text style={styles.voiceCancelText}>取消</Text></Pressable></View></View></Modal>;
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

function ComposerActions({ voicePending, canSend, onVoice, onSend }: { voicePending: boolean; canSend: boolean; onVoice: () => void; onSend: () => void }) {
  return <View style={styles.composerActions}><Pressable accessibilityRole="button" accessibilityLabel="语音输入" disabled={voicePending} onPress={onVoice} style={({ pressed }) => [styles.voiceButton, voicePending && styles.voiceButtonActive, pressed && styles.pressed]}>{voicePending ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="mic-outline" size={21} color={colors.textSecondary} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="发送" disabled={!canSend} onPress={onSend} style={[styles.send, !canSend && styles.sendDisabled]}><Ionicons name="send" size={18} color="#FFFFFF" /></Pressable></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1 }, conversation: { flex: 1 }, content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl }, pressed: { opacity: 0.68 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md }, headerCopy: { flex: 1, minWidth: 0 }, title: { ...typography.display, color: colors.text, fontSize: 27, lineHeight: 35 }, subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.xs }, newChat: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, newChatText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  welcome: { alignItems: 'center', marginTop: 72, paddingHorizontal: spacing.xl }, aiAvatar: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.accentSoft }, welcomeTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, welcomeText: { ...typography.body, color: colors.textSecondary, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm },
  questionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl }, questionBubble: { maxWidth: '82%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 18, backgroundColor: '#E4F1EB' }, questionText: { ...typography.bodyStrong, color: colors.text, lineHeight: 22 }, userAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#EFEEEA' },
  thinking: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, botAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.accentSoft }, thinkingText: { ...typography.caption, color: colors.textSecondary },
  bottomSafe: { backgroundColor: colors.surface }, bottomRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 9 }, bottomRowExpanded: { minHeight: 112, paddingTop: spacing.sm, paddingBottom: spacing.md },
  composer: { flex: 1, minHeight: 56, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 26, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, composerExpanded: { minHeight: 96, borderRadius: 24, paddingHorizontal: spacing.md, paddingVertical: 7 }, composerInputRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9 }, composerToolsRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, composerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 }, addButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 }, input: { ...typography.body, color: colors.text, flex: 1, minWidth: 0, maxHeight: 72, paddingVertical: 6 }, voiceButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 }, voiceButtonActive: { backgroundColor: colors.accentSoft }, send: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primary }, sendDisabled: { backgroundColor: '#D1D1CE' }, voiceError: { fontSize: 10, lineHeight: 15, color: colors.danger, paddingHorizontal: spacing.xl, paddingTop: spacing.xs }, attachmentChip: { alignSelf: 'center', maxWidth: '72%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, marginTop: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.accentSoft }, attachmentName: { flexShrink: 1, fontSize: 11, color: colors.primary, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(31, 34, 31, 0.28)' }, sheet: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface }, sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }, sheetTitle: { ...typography.cardTitle, color: colors.text }, sheetHint: { fontSize: 11, lineHeight: 16, color: colors.textMuted, marginTop: 3 }, closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F1ED' }, sheetAction: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sheetActionDisabled: { opacity: 0.58 }, sheetActionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, sheetActionCopy: { flex: 1 }, sheetActionTitle: { ...typography.bodyStrong, color: colors.text }, sheetActionDetail: { fontSize: 11, lineHeight: 17, color: colors.textSecondary, marginTop: 2 }, pendingBadge: { fontSize: 10, color: colors.textMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#F0EFEB' },
  voiceBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(24, 30, 27, 0.42)' }, voiceCard: { width: '100%', maxWidth: 330, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: 34, paddingBottom: spacing.xl, borderRadius: 30, backgroundColor: colors.surface }, voiceOrb: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 6 }, voiceTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, voiceHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, textAlign: 'center', marginTop: spacing.sm }, voiceBars: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.lg }, voiceBar: { width: 6, borderRadius: 3, backgroundColor: colors.primary }, voiceCancel: { minWidth: 112, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: '#F0EFEB' }, voiceCancelText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  askButton: { minHeight: 46, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, askButtonDisabled: { backgroundColor: colors.textMuted }, askButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  aiCard: { alignItems: 'flex-start', marginTop: spacing.lg, marginLeft: 48, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#615B53', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 }, aiIcon: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.md },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.sm }, missingBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignSelf: 'stretch' }, missingItem: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  demoNotice: { fontSize: 10, lineHeight: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
