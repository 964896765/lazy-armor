import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { cancelSystemSpeechRecognition, startSystemSpeechRecognition } from '../../src/device-app-bridge';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { AI_DEMO_NOTICE, buildAiResponse, type PlannerResultLike } from '../../src/search-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];
type AiPrompt = { display: string; query: string };
type LocalAttachment = { name: string; excerpt: string; size: number };

const COMPOSER_INPUT_MIN_HEIGHT = 40;
const COMPOSER_INPUT_MAX_HEIGHT = 116;

export default function ChatPage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<'chat' | 'work'>('chat');
  const [aiQuery, setAiQuery] = useState('');
  const [voicePending, setVoicePending] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const voiceCancelled = useRef(false);

  const ask = useMutation({
    mutationFn: (input: AiPrompt) => api<PlannerResultLike>('/chat/plan', token, {
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
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setAttachment(null);
  }

  function resetConversation() {
    ask.reset();
    setAiQuery('');
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
  }

  async function startVoiceInput() {
    if (voicePending) return;
    Keyboard.dismiss();
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

  return <SafeAreaView edges={['top']} style={styles.safeArea}><KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.pageHeader}><Text style={styles.pageTitle}>问一问</Text><Pressable accessibilityRole="button" accessibilityLabel="新对话" onPress={resetConversation} style={({ pressed }) => [styles.newChatButton, pressed && styles.pressed]}><Ionicons name="add" size={18} color="#1769E0" /><Text style={styles.newChatText}>新对话</Text></Pressable></View>
    <View style={styles.modeBar}><ModeTab label="聊天" selected={mode === 'chat'} onPress={() => setMode('chat')} /><ModeTab label="工作" selected={mode === 'work'} onPress={() => setMode('work')} /></View>
    <Pressable style={styles.conversation} onPress={Keyboard.dismiss} accessible={false}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="never" keyboardDismissMode="on-drag">
      {!submittedQuestion && !ask.isPending && mode === 'chat' ? <ChatEmpty onSelect={setAiQuery} /> : null}
      {!submittedQuestion && !ask.isPending && mode === 'work' ? <WorkEmpty onSelect={setAiQuery} /> : null}
      {submittedQuestion ? <View style={styles.questionRow}><View style={styles.questionBubble}><Text style={styles.questionText}>{submittedQuestion}</Text></View><View style={styles.userAvatar}><Ionicons name="person-outline" size={20} color={colors.primary} /></View></View> : null}
      {ask.isPending ? <View style={styles.thinking}><View style={styles.botAvatar}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /></View><ActivityIndicator color={colors.primary} /><Text style={styles.thinkingText}>正在分析…</Text></View> : null}
      {ask.isError ? <View style={styles.aiCard}><Text style={styles.cardTitle}>AI 暂不可用</Text><Text style={styles.body}>当前没有取得服务端结果，请稍后再试。</Text></View> : null}
      {ask.data && !ask.isError ? <AiResultCard response={aiResponse} onJumpToWizard={canJumpToWizard ? () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(aiResponse.scenarioKey!)}` as never) : undefined} /> : null}
    </ScrollView></Pressable>
    <SafeAreaView edges={['bottom']} style={styles.bottomSafe}>{voiceError ? <Text style={styles.voiceError}>{voiceError}</Text> : null}{attachment ? <View style={styles.attachmentChip}><Ionicons name="document-text-outline" size={15} color={colors.primary} /><Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="移除资料" onPress={() => setAttachment(null)} hitSlop={8}><Ionicons name="close" size={17} color={colors.textSecondary} /></Pressable></View> : null}<View style={styles.bottomRow}><View style={styles.composer}>
      <Pressable accessibilityRole="button" accessibilityLabel="添加资料" onPress={() => { Keyboard.dismiss(); setAttachmentMenuOpen(true); }} style={styles.addButton}><Ionicons name="add" size={27} color="#1F2937" /></Pressable><TextInput value={aiQuery} onChangeText={(value) => { setAiQuery(value); setVoiceError(null); }} onContentSizeChange={(event) => setComposerInputHeight(Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.min(event.nativeEvent.contentSize.height, COMPOSER_INPUT_MAX_HEIGHT)))} placeholder={mode === 'work' ? '描述你想设计的计划模板' : '询问懒人装甲'} placeholderTextColor="#778392" style={[styles.input, { height: composerInputHeight }]} multiline scrollEnabled={composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT} textAlignVertical="top" maxLength={500} /><ComposerActions voicePending={voicePending} canSend={Boolean(aiQuery.trim() && !ask.isPending && token)} onVoice={startVoiceInput} onSend={submit} />
    </View></View></SafeAreaView>
    <AttachmentSheet open={attachmentMenuOpen} onClose={() => setAttachmentMenuOpen(false)} onPickFile={() => void pickLocalFile()} />
    <VoiceOverlay open={voiceOpen} onCancel={() => void cancelVoiceInput()} />
  </KeyboardAvoidingView></SafeAreaView>;
}

function ModeTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeTab, selected && styles.modeTabSelected]}><Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text></Pressable>; }

function ChatEmpty({ onSelect }: { onSelect: (value: string) => void }) {
  const suggestions = [{ icon: 'sunny-outline' as IconName, text: '早上好！\n今天心情有点低落，能陪我聊聊吗？' }, { icon: 'document-text-outline' as IconName, text: '我最近工作压力有点大，\n总觉得时间不够用，怎么办？' }, { icon: 'bulb-outline' as IconName, text: '给我一些让生活更轻松的小建议吧' }];
  return <View style={styles.emptyChat}>{suggestions.map((item) => <Pressable key={item.text} onPress={() => onSelect(item.text.replace('\n', ''))} style={styles.suggestion}><View style={styles.suggestionIcon}><Ionicons name={item.icon} size={25} color="#347FF0" /></View><Text style={styles.suggestionText}>{item.text}</Text><Ionicons name="chevron-forward" size={23} color="#53627A" /></Pressable>)}</View>;
}

function WorkEmpty({ onSelect }: { onSelect: (value: string) => void }) {
  const steps = [{ icon: 'locate-outline' as IconName, title: '设计模板目标', detail: '明确这份计划模板要达成什么', prompt: '帮我设计一份计划模板，并先明确目标' }, { icon: 'list-outline' as IconName, title: '设定步骤', detail: '拆解关键步骤，规划执行流程', prompt: '帮我拆解计划的关键步骤' }, { icon: 'cube-outline' as IconName, title: '选择资源', detail: '需要哪些工具、材料或参考内容', prompt: '帮我选择完成计划需要的资源' }, { icon: 'notifications-outline' as IconName, title: '设定提醒', detail: '安排执行频率与提醒方式', prompt: '帮我设定计划的执行频率和提醒' }];
  return <View style={styles.workEmpty}><View style={styles.workHero}><View style={styles.workHeroIcon}><Ionicons name="sparkles-outline" size={39} color="#416DF1" /></View><Text style={styles.workTitle}>欢迎使用工作模式</Text><Text style={styles.workDetail}>我可以帮你制定计划模板，通过对话明确目标、步骤、资源和提醒，生成可直接使用的模板。</Text></View><View style={styles.workSteps}>{steps.map((item) => <Pressable key={item.title} onPress={() => onSelect(item.prompt)} style={styles.workStep}><View style={styles.workStepIcon}><Ionicons name={item.icon} size={28} color="#347FF0" /></View><View style={styles.workStepCopy}><Text style={styles.workStepTitle}>{item.title}</Text><Text style={styles.workStepDetail}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={23} color="#677486" /></Pressable>)}</View></View>;
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
  safeArea: { flex: 1, backgroundColor: 'rgba(248,250,253,0.90)' }, page: { flex: 1 }, conversation: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 }, pressed: { opacity: 0.68 },
  pageHeader: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18, paddingTop: 8 }, pageTitle: { color: '#111827', fontSize: 30, lineHeight: 37, fontWeight: '700' }, newChatButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D8E2F0', backgroundColor: '#FFFFFF' }, newChatText: { color: '#1769E0', fontSize: 14, fontWeight: '600' }, modeBar: { alignSelf: 'flex-start', flexDirection: 'row', gap: 22, marginLeft: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DCE3EC' }, modeTab: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderBottomWidth: 2, borderBottomColor: 'transparent' }, modeTabSelected: { borderBottomColor: '#2F80ED' }, modeText: { color: '#687588', fontSize: 14 }, modeTextSelected: { color: '#162033', fontWeight: '600' },
  emptyChat: { flex: 1, justifyContent: 'flex-end', gap: 10, paddingBottom: 8, paddingTop: 220 }, suggestion: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.72)' }, suggestionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(235,243,255,0.94)' }, suggestionText: { flex: 1, color: '#253245', fontSize: 15, lineHeight: 22 },
  workEmpty: { paddingTop: 70 }, workHero: { alignItems: 'center', paddingHorizontal: 22, paddingBottom: 28 }, workHeroIcon: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: 'rgba(239,243,255,0.92)' }, workTitle: { marginTop: 20, color: '#101720', fontSize: 23, lineHeight: 31, fontWeight: '800' }, workDetail: { marginTop: 10, color: '#637083', fontSize: 15, lineHeight: 25, textAlign: 'center' }, workSteps: { gap: 10 }, workStep: { minHeight: 79, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.76)' }, workStepIcon: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(237,244,255,0.94)' }, workStepCopy: { flex: 1 }, workStepTitle: { color: '#121A26', fontSize: 17, lineHeight: 24, fontWeight: '800' }, workStepDetail: { marginTop: 2, color: '#697789', fontSize: 13, lineHeight: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm }, headerCopy: { flex: 1, minWidth: 0 }, title: { ...typography.pageTitle, color: colors.text }, assistantTitle: { ...typography.bodyStrong, color: colors.text }, subtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginTop: 2 }, newChat: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, newChatText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  welcomeMessage: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 }, aiAvatar: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#EAF3FF' }, welcomeBubble: { flex: 1, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: 'rgba(246,248,252,0.86)' }, welcomeTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14 }, welcomeText: { fontSize: 13, color: colors.textSecondary, lineHeight: 22, marginTop: 3 },
  questionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl }, questionBubble: { maxWidth: '82%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 18, backgroundColor: '#E4F1EB' }, questionText: { ...typography.bodyStrong, color: colors.text, lineHeight: 22 }, userAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#EFEEEA' },
  thinking: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, botAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.accentSoft }, thinkingText: { ...typography.caption, color: colors.textSecondary },
  bottomSafe: { backgroundColor: '#F8FAFD' }, bottomRow: { minHeight: 70, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 }, bottomRowExpanded: { minHeight: 70 },
  composer: { flex: 1, minHeight: 54, flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6E0EC' }, composerExpanded: { minHeight: 54 }, composerInputRow: { flex: 1 }, composerToolsRow: { flexDirection: 'row' }, composerActions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 1 }, addButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' }, input: { color: '#172131', flex: 1, minWidth: 0, minHeight: COMPOSER_INPUT_MIN_HEIGHT, maxHeight: 116, paddingHorizontal: 3, paddingTop: 10, paddingBottom: 6, fontSize: 15, lineHeight: 21 }, voiceButton: { width: 36, height: 42, alignItems: 'center', justifyContent: 'center' }, voiceButtonActive: { backgroundColor: colors.accentSoft }, send: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#2F80ED' }, sendDisabled: { backgroundColor: '#A8C8F5' }, voiceError: { fontSize: 13, lineHeight: 20, color: colors.danger, paddingHorizontal: 16, paddingTop: 4 }, attachmentChip: { alignSelf: 'center', maxWidth: '72%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, marginTop: 3, borderRadius: 8, backgroundColor: colors.accentSoft }, attachmentName: { flexShrink: 1, fontSize: 13, color: colors.primary, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(31, 34, 31, 0.28)' }, sheet: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface }, sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }, sheetTitle: { ...typography.cardTitle, color: colors.text }, sheetHint: { fontSize: 13, lineHeight: 21, color: colors.textMuted, marginTop: 3 }, closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F1ED' }, sheetAction: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sheetActionDisabled: { opacity: 0.58 }, sheetActionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, sheetActionCopy: { flex: 1 }, sheetActionTitle: { ...typography.bodyStrong, color: colors.text }, sheetActionDetail: { fontSize: 13, lineHeight: 22, color: colors.textSecondary, marginTop: 2 }, pendingBadge: { fontSize: 13, color: colors.textMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#F0EFEB' },
  voiceBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(24, 30, 27, 0.42)' }, voiceCard: { width: '100%', maxWidth: 330, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: 34, paddingBottom: spacing.xl, borderRadius: 30, backgroundColor: colors.surface }, voiceOrb: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 6 }, voiceTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, voiceHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, textAlign: 'center', marginTop: spacing.sm }, voiceBars: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.lg }, voiceBar: { width: 6, borderRadius: 3, backgroundColor: colors.primary }, voiceCancel: { minWidth: 112, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: '#F0EFEB' }, voiceCancelText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  askButton: { minHeight: 46, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, askButtonDisabled: { backgroundColor: colors.textMuted }, askButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  aiCard: { alignItems: 'flex-start', marginTop: 10, marginLeft: 42, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: 'rgba(246,248,252,0.88)' }, aiIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, cardTitle: { ...typography.bodyStrong, color: colors.text, marginTop: 7 },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.sm }, missingBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignSelf: 'stretch' }, missingItem: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
  demoNotice: { fontSize: 13, lineHeight: 20, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

