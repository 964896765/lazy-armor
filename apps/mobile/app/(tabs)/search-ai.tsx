import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { useAuthStore } from "../../src/auth-store";
import {
  useChatHistory,
  type ChatHistoryItem,
} from "../../src/chat-history-store";
import {
  cancelSystemSpeechRecognition,
  finishSystemSpeechRecognition,
  startSystemSpeechRecognition,
} from "../../src/device-app-bridge";
import {
  workspaceColors as colors,
  radius,
  spacing,
  typography,
} from "../../src/design";
import {
  AI_DEMO_NOTICE,
  buildAiResponse,
  type PlannerResultLike,
} from "../../src/search-presenter";

type IconName = ComponentProps<typeof Ionicons>["name"];
type AiPrompt = { display: string; query: string };
type LocalAttachment = { name: string; excerpt: string; size: number };

const COMPOSER_INPUT_MIN_HEIGHT = 40;
const COMPOSER_INPUT_MAX_HEIGHT = 196;

type ChatMode = 'chat' | 'work';
const QUICK_ACTIONS: readonly { icon: IconName; title: string; detail: string; prompt: string; tint: string; background: string }[] = [
  { icon: 'checkbox', title: '创建计划', detail: '把想法变成可执行计划', prompt: '帮我创建一个新的计划', tint: '#1686F5', background: '#E3F2FF' },
  { icon: 'document-text', title: '整理信息', detail: '总结、提取、翻译', prompt: '帮我整理并总结信息', tint: '#8268F5', background: '#EEE9FF' },
  { icon: 'bulb', title: '获取建议', detail: '分析问题，给出方案', prompt: '帮我分析一个问题并给出建议', tint: '#0BBF88', background: '#DFF9F0' },
  { icon: 'people', title: '调用服务', detail: '连接资源与执行能力', prompt: '帮我看看可以调用哪些服务', tint: '#F5A000', background: '#FFF2DC' },
];
const WELCOME_PROMPTS: Record<ChatMode, readonly { icon: IconName; prompt: string }[]> = {
  chat: [
    { icon: 'calendar-outline', prompt: '帮我制定本周的工作计划' },
    { icon: 'airplane-outline', prompt: '帮我规划下个月的旅行行程' },
    { icon: 'document-text-outline', prompt: '总结这份文档的核心内容' },
    { icon: 'cart-outline', prompt: '帮我比较这几款产品' },
    { icon: 'code-slash-outline', prompt: '帮我写一份 PPT 大纲' },
    { icon: 'chatbubble-ellipses-outline', prompt: '还有什么我可以做的？' },
  ],
  work: [
    { icon: 'calendar-outline', prompt: '帮我制定本周的工作计划' },
    { icon: 'checkbox-outline', prompt: '帮我整理一下待办事项' },
    { icon: 'document-text-outline', prompt: '总结这份文档的核心内容' },
    { icon: 'git-network-outline', prompt: '帮我制定一个可执行的工作计划' },
    { icon: 'analytics-outline', prompt: '帮我梳理最近的工作进展' },
    { icon: 'chatbubble-ellipses-outline', prompt: '还有什么我可以做的？' },
  ],
};

export default function SearchAiPage() {
  const token = useAuthStore((store) => store.token);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<{ displayName?: string }>('/me', token), enabled: Boolean(token), staleTime: 60_000 });
  const [mode, setMode] = useState<ChatMode>('chat');
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const history = useChatHistory((state) => state.items);
  const addHistory = useChatHistory((state) => state.add);
  const [selectedConversation, setSelectedConversation] =
    useState<ChatHistoryItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setSelectedConversation(
      history.find(
        (item) => item.id === params.conversationId && item.owner === token,
      ) ?? null,
    );
  }, [params.conversationId, token]);
  const [aiQuery, setAiQuery] = useState("");
  const [voicePending, setVoicePending] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [composerInputHeight, setComposerInputHeight] = useState(
    COMPOSER_INPUT_MIN_HEIGHT,
  );
  const voiceCancelled = useRef(false);
  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => { setKeyboardVisible(true); setKeyboardHeight(event.endCoordinates.height); });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { setKeyboardVisible(false); setKeyboardHeight(0); });
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  const ask = useMutation({
    mutationFn: (input: AiPrompt) =>
      api<PlannerResultLike>("/templates/natural-language/agent", token, {
        method: "POST",
        body: JSON.stringify({ query: input.query }),
      }),
    onSuccess: (result, input) => {
      if (token) addHistory(token, input.display, result);
    },
  });
  const responseData = selectedConversation?.result ?? ask.data;
  const aiResponse = buildAiResponse(responseData);
  const canJumpToWizard =
    aiResponse.kind === "PLAN_DRAFT" && Boolean(aiResponse.scenarioKey);
  const submittedQuestion =
    selectedConversation?.question ?? ask.variables?.display.trim() ?? "";

  function submit() {
    const question = aiQuery.trim();
    if (!question || ask.isPending) return;
    const context = attachment
      ? `\n\n用户选择的本地资料《${attachment.name}》摘录：\n${attachment.excerpt}`
      : "";
    setSelectedConversation(null);
    ask.mutate({
      display: question,
      query: `${question}${context}`.slice(0, 500),
    });
    setAiQuery("");
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setAttachment(null);
  }

  function resetConversation() {
    setSelectedConversation(null);
    ask.reset();
    setAiQuery("");
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setAttachment(null);
    setDrawerOpen(false);
  }

  async function startVoiceInput() {
    if (voicePending) return;
    Keyboard.dismiss();
    voiceCancelled.current = false;
    setVoicePending(true);
    setVoiceTranscript(null);
    setVoiceOpen(true);
    setVoiceError(null);
    const transcript = await startSystemSpeechRecognition("zh-CN");
    setVoicePending(false);
    if (voiceCancelled.current) return;
    if (!transcript) {
      setVoiceError("没有听清，请检查麦克风权限后重试。");
      return;
    }
    setVoiceTranscript(transcript);
    setAiQuery(
      (current) => `${current}${current.trim() ? " " : ""}${transcript}`,
    );
  }

  async function cancelVoiceInput() {
    voiceCancelled.current = true;
    await cancelSystemSpeechRecognition();
    setVoicePending(false);
    setVoiceOpen(false);
  }

  async function finishVoiceInput() {
    if (!voicePending) { setVoiceOpen(false); return; }
    const finishing = await finishSystemSpeechRecognition();
    if (!finishing) await cancelVoiceInput();
  }

  async function pickLocalFile() {
    setAttachmentMenuOpen(false);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["text/plain", "text/csv", "application/json"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset || (asset.size ?? 0) > 500_000) {
      setVoiceError("资料需为不超过 500 KB 的 TXT、CSV 或 JSON 文件。");
      return;
    }
    try {
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const excerpt = content.replace(/\s+/g, " ").trim().slice(0, 260);
      if (!excerpt) throw new Error("EMPTY_FILE");
      setAttachment({
        name: asset.name.slice(0, 80),
        excerpt,
        size: asset.size ?? content.length,
      });
      setVoiceError(null);
    } catch {
      setVoiceError("没有读取到可用于提问的文字内容。");
    }
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.chatHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开聊天侧栏"
            onPress={() => {
              Keyboard.dismiss();
              setDrawerOpen(true);
            }}
            style={styles.headerCircle}
          >
            <Ionicons name="menu-outline" size={25} color={colors.text} />
          </Pressable>
          <View style={styles.chatSegments}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'chat' }}
              onPress={() => setMode('chat')}
              style={[styles.chatSegment, mode === 'chat' && styles.chatSegmentSelected]}
            >
              <Text style={styles.chatSegmentLabel}>聊天</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'work' }}
              onPress={() => setMode('work')}
              style={[styles.chatSegment, mode === 'work' && styles.chatSegmentSelected]}
            >
              <Text style={styles.chatSegmentLabel}>工作</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新对话"
            onPress={resetConversation}
            style={styles.headerCircle}
          >
            <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        <Pressable
          style={styles.conversation}
          onPress={Keyboard.dismiss}
          accessible={false}
        >
          <ScrollView
            contentContainerStyle={[styles.content, keyboardVisible && { paddingBottom: keyboardHeight + 140 }]}
            keyboardShouldPersistTaps="never"
            keyboardDismissMode="on-drag"
          >
            {!submittedQuestion && !ask.isPending ? (
              <View style={styles.welcome}>
                <View style={styles.welcomeHeading}>
                  <View style={styles.introAvatar}><Ionicons name="person-outline" size={37} color={colors.text} /></View>
                  <View style={styles.welcomeCopy}>
                    <Text style={styles.welcomeTitle}>你好，{profile.data?.displayName?.trim() || '朋友'}</Text>
                    <Text style={styles.welcomeSubtitle}>{mode === 'chat' ? '今天想处理什么？ ✨' : '今天先推进哪件工作？ ✨'}</Text>
                  </View>
                </View>
                <View style={styles.quickGrid}>{QUICK_ACTIONS.map((item) => <Pressable key={item.title} accessibilityRole="button" onPress={() => setAiQuery(item.prompt)} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}><View style={[styles.quickIcon, { backgroundColor: item.background }]}><Ionicons name={item.icon} size={22} color={item.tint} /></View><View style={styles.quickCopy}><Text style={styles.quickTitle}>{item.title}</Text><Text numberOfLines={1} style={styles.quickDetail}>{item.detail}</Text></View></Pressable>)}</View>
                <Text style={styles.suggestionHeading}>你可以这样问我</Text>
                <View style={styles.focusList}>
                  {WELCOME_PROMPTS[mode].map((item) => (
                    <Pressable
                      key={item.prompt}
                      accessibilityRole="button"
                      onPress={() => setAiQuery(item.prompt)}
                      style={({ pressed }) => [
                        styles.focusRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name={item.icon} size={20} color={colors.text} />
                      <Text style={styles.focusLabel}>{item.prompt}</Text>
                      <Ionicons
                        name="chevron-forward"
                        size={15}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {submittedQuestion ? <View style={styles.timeDivider}><Text style={styles.timeDividerText}>今天</Text></View> : null}
            {submittedQuestion ? (
              <View style={styles.questionRow}>
                <View style={styles.questionBubble}>
                  <Text style={styles.questionText}>{submittedQuestion}</Text>
                </View>
              </View>
            ) : null}
            {ask.isPending ? (
              <View style={styles.thinking}>
                <View style={styles.botAvatar}>
                  <Ionicons
                    name="sparkles-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.thinkingText}>正在分析…</Text>
              </View>
            ) : null}
            {ask.isError ? (
              <View style={styles.aiCard}>
                <Text style={styles.cardTitle}>AI 暂不可用</Text>
                <Text style={styles.body}>
                  当前没有取得服务端结果，请稍后再试。
                </Text>
              </View>
            ) : null}
            {responseData && !ask.isError ? (
              <View style={styles.answerRow}><View style={styles.botAvatar}><Ionicons name="sparkles-outline" size={20} color={colors.primary} /></View><AiResultCard
                  response={aiResponse}
                  onJumpToWizard={
                    canJumpToWizard
                      ? () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(aiResponse.scenarioKey!)}` as never)
                      : undefined
                  }
                /></View>
            ) : null}
          </ScrollView>
        </Pressable>
        <SafeAreaView edges={keyboardVisible ? [] : ["bottom"]} style={[styles.bottomSafe, keyboardVisible && { bottom: keyboardHeight + 24 }]}>
          {voiceError ? (
            <Text style={styles.voiceError}>{voiceError}</Text>
          ) : null}
          {attachment ? (
            <View style={styles.attachmentChip}>
              <Ionicons
                name="document-text-outline"
                size={15}
                color={colors.primary}
              />
              <Text numberOfLines={1} style={styles.attachmentName}>
                {attachment.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="移除资料"
                onPress={() => setAttachment(null)}
                hitSlop={8}
              >
                <Ionicons name="close" size={17} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.bottomRow}>
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="添加资料" onPress={() => { Keyboard.dismiss(); setAttachmentMenuOpen(true); }} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Ionicons name="add" size={23} color={colors.text} /></Pressable>
              <TextInput
                ref={inputRef}
                value={aiQuery}
                onChangeText={(value) => { setAiQuery(value); setVoiceError(null); }}
                onContentSizeChange={(event) => setComposerInputHeight(Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.min(event.nativeEvent.contentSize.height, COMPOSER_INPUT_MAX_HEIGHT)))}
                placeholder={submittedQuestion ? '继续提问或发送消息…' : '告诉我任何问题…'}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { height: composerInputHeight }]}
                multiline
                scrollEnabled={composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
                textAlignVertical="center"
                maxLength={500}
              />
              <ComposerActions voicePending={voicePending} canSend={Boolean(aiQuery.trim() && !ask.isPending && token)} onVoice={startVoiceInput} onSend={submit} />
            </View>
          </View>
        </SafeAreaView>
        <Modal
          visible={drawerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDrawerOpen(false)}
        >
          <View style={styles.chatDrawerBackdrop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭聊天侧栏"
              style={StyleSheet.absoluteFill}
              onPress={() => setDrawerOpen(false)}
            />
            <SafeAreaView edges={["top", "bottom"]} style={styles.chatDrawer}>
              <View style={styles.chatDrawerHeading}>
                <Text style={styles.chatDrawerBrand}>对话记录</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="关闭侧栏"
                  onPress={() => setDrawerOpen(false)}
                  style={styles.headerCircle}
                >
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView>
                <Text style={styles.chatHistoryCaption}>本次使用期间</Text>
                {history.filter((item) => item.owner === token).length ? (
                  history
                    .filter((item) => item.owner === token)
                    .map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => {
                          ask.reset();
                          setSelectedConversation(item);
                          setDrawerOpen(false);
                        }}
                        style={styles.chatDrawerRow}
                      >
                        <Text numberOfLines={1} style={styles.chatHistoryLabel}>
                          {item.question}
                        </Text>
                      </Pressable>
                    ))
                ) : (
                  <Text style={styles.chatHistoryEmpty}>还没有对话记录</Text>
                )}
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
        <AttachmentSheet
          open={attachmentMenuOpen}
          onClose={() => setAttachmentMenuOpen(false)}
          onPickFile={() => void pickLocalFile()}
        />
        <VoiceOverlay
          open={voiceOpen}
          listening={voicePending}
          transcript={voiceTranscript}
          onCancel={() => void cancelVoiceInput()}
          onKeyboard={() => { void cancelVoiceInput(); setTimeout(() => inputRef.current?.focus(), 250); }}
          onDone={() => void finishVoiceInput()}
          onRepeat={() => void startVoiceInput()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AttachmentSheet({
  open,
  onClose,
  onPickFile,
}: {
  open: boolean;
  onClose: () => void;
  onPickFile: () => void;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>添加资料</Text>
              <Text style={styles.sheetHint}>
                资料只在你明确选择后用于本次提问
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={23} color={colors.text} />
            </Pressable>
          </View>
          <SheetAction
            icon="document-text-outline"
            title="文件"
            detail="读取 TXT、CSV 或 JSON 的文字摘录"
            onPress={onPickFile}
          />
          <SheetAction
            icon="link-outline"
            title="已连接的信息源"
            detail="前往连接中心选择已授权来源"
            onPress={() => {
              onClose();
              router.push("/connections" as never);
            }}
          />
          <SheetAction
            icon="image-outline"
            title="照片"
            detail="图片理解接口尚未接入"
            disabled
          />
          <SheetAction
            icon="camera-outline"
            title="摄像头"
            detail="拍摄与图像理解尚未接入"
            disabled
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({
  icon,
  title,
  detail,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  title: string;
  detail: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetAction,
        disabled && styles.sheetActionDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.sheetActionIcon}>
        <Ionicons
          name={icon}
          size={22}
          color={disabled ? colors.textMuted : colors.primary}
        />
      </View>
      <View style={styles.sheetActionCopy}>
        <Text style={styles.sheetActionTitle}>{title}</Text>
        <Text style={styles.sheetActionDetail}>{detail}</Text>
      </View>
      {disabled ? (
        <Text style={styles.pendingBadge}>待接入</Text>
      ) : (
        <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

function VoiceOverlay({
  open,
  listening,
  transcript,
  onCancel,
  onKeyboard,
  onDone,
  onRepeat,
}: {
  open: boolean;
  listening: boolean;
  transcript: string | null;
  onCancel: () => void;
  onKeyboard: () => void;
  onDone: () => void;
  onRepeat: () => void;
}) {
  return (
    <Modal
      visible={open}
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <LinearGradient colors={['#DDEEFF', '#F6FAFF', '#FFF1E2']} locations={[0, 0.56, 1]} style={styles.voiceScreen}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.voiceScreenSafe}>
          <View style={styles.voiceHeader}><Pressable accessibilityRole="button" accessibilityLabel="关闭语音对话" onPress={onCancel} style={styles.voiceHeaderClose}><Ionicons name="close" size={23} color={colors.text} /></Pressable><Text style={styles.voiceScreenTitle}>问一问</Text><View style={styles.voiceHeaderClose} /></View>
          <View style={styles.voiceCenter}>
            <Pressable accessibilityRole="button" accessibilityLabel="重试语音识别" disabled={listening} onPress={onRepeat} style={styles.voiceOuterRing}><View style={styles.voiceInnerRing}><LinearGradient colors={['#63C8FF', '#3E72F8']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.voiceOrb}><View style={styles.voiceWaveform}>{[4, 9, 18, 9, 4].map((height, index) => <View key={index} style={[styles.voiceWaveBar, { height }]} />)}</View></LinearGradient></View></Pressable>
            <Text style={styles.voiceListening}>{listening ? '我在听，请说话...' : transcript ? '已识别，点击完成' : '没有听清，请重试'}</Text>
          </View>
          <View style={styles.voiceFooter}>
            <Pressable accessibilityRole="button" accessibilityLabel="切换键盘输入" onPress={onKeyboard} style={styles.voiceSideButton}><Ionicons name="keypad-outline" size={18} color={colors.text} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="暂停语音输入" onPress={onCancel} style={styles.voicePauseButton}><Ionicons name="pause" size={25} color={colors.primary} /></Pressable>
            <Pressable accessibilityRole="button" onPress={onDone} style={styles.voiceDoneButton}><Text style={styles.voiceDoneText}>完成</Text></Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

function AiResultCard({
  response,
  onJumpToWizard,
}: {
  response: ReturnType<typeof buildAiResponse>;
  onJumpToWizard?: () => void;
}) {
  return (
    <View style={styles.aiCard}>
      <View style={styles.aiIcon}>
        <Ionicons name="sparkles-outline" size={24} color={colors.primary} />
      </View>
      <Text style={styles.cardTitle}>{response.title}</Text>
      {response.body ? <Text style={styles.body}>{response.body}</Text> : null}
      {response.missingRequirements.length > 0 ? (
        <View style={styles.missingBox}>
          {response.missingRequirements.map((item) => (
            <Text key={item} style={styles.missingItem}>
              · {item}
            </Text>
          ))}
        </View>
      ) : null}
      {onJumpToWizard ? (
        <Pressable
          accessibilityRole="button"
          onPress={onJumpToWizard}
          style={styles.askButton}
        >
          <Text style={styles.askButtonText}>去创建向导继续</Text>
        </Pressable>
      ) : null}
      <Text style={styles.demoNotice}>{AI_DEMO_NOTICE}</Text>
    </View>
  );
}

function ComposerActions({
  voicePending,
  canSend,
  onVoice,
  onSend,
}: {
  voicePending: boolean;
  canSend: boolean;
  onVoice: () => void;
  onSend: () => void;
}) {
  return (
    <View style={styles.composerActions}>
      {canSend ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="发送"
        onPress={onSend}
        style={styles.send}
      >
        <Ionicons name="arrow-up" size={23} color="#FFFFFF" />
      </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="语音输入" disabled={voicePending} onPress={onVoice} style={({ pressed }) => [styles.voiceButton, voicePending && styles.voiceButtonActive, pressed && styles.pressed]}>{voicePending ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="mic-outline" size={23} color={colors.text} />}</Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  chatHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  headerCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  chatSegments: {
    flexDirection: "row",
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.44)",
    padding: 4,
  },
  chatSegment: {
    minWidth: 68,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  chatSegmentSelected: {
    minWidth: 68,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
  },
  chatSegmentLabel: { fontSize: 14, color: colors.text },
  composerContext: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 16,
    padding: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "rgba(245,245,247,0.86)",
  },
  composerContextText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginRight: 10,
  },
  expandButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  chatDrawerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  chatDrawer: {
    width: "82%",
    maxWidth: 360,
    height: "100%",
    paddingHorizontal: 24,
    backgroundColor: "#FFFFFF",
  },
  chatDrawerHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
  },
  chatDrawerBrand: { fontSize: 23, fontWeight: "700", color: colors.text },
  chatDrawerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 54,
  },
  chatDrawerLabel: { fontSize: 17, fontWeight: "600", color: colors.text },
  chatDrawerDivider: {
    height: 1,
    backgroundColor: "#ECEDEF",
    marginVertical: 20,
  },
  chatHistoryCaption: { fontSize: 11, color: colors.textMuted },
  chatHistoryEmpty: {
    fontSize: 14,
    color: colors.textMuted,
    paddingVertical: 20,
  },
  chatHistoryLabel: { flex: 1, fontSize: 15, color: colors.text },
  chatDrawerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  chatNewButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 28,
    minHeight: 48,
    paddingHorizontal: 20,
    backgroundColor: "#3865F5",
  },
  chatNewLabel: { fontSize: 16, color: "#FFFFFF" },
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  conversation: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 105 },
  pressed: { opacity: 0.68 },
  titleRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { ...typography.pageTitle, color: colors.text },
  chatSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -2,
  },
  newChat: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  timeDivider: {
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  timeDividerText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.36)",
  },
  welcome: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xs, paddingBottom: spacing.md },
  welcomeHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  welcomeCopy: { flex: 1 },
  welcomeTitle: { ...typography.pageTitle, color: colors.text },
  welcomeSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  botRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  introAvatar: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 40,
    backgroundColor: "rgba(255,213,202,0.9)",
  },
  botMessage: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    backgroundColor: "rgba(255,255,255,0.80)",
  },
  botText: { ...typography.body, color: colors.text, lineHeight: 22 },
  focusPrompt: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
  quickCard: { width: '48.5%', minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.75)' },
  quickIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickCopy: { flex: 1, minWidth: 0 }, quickTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13 }, quickDetail: { ...typography.caption, color: colors.textSecondary, fontSize: 9, marginTop: 2 },
  suggestionHeading: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  focusList: { borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.82)', overflow: 'hidden' },
  focusRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(160,170,184,0.26)',
  },
  focusIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.accentSoft },
  focusMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
  },
  focusCopy: { flex: 1, minWidth: 0 },
  focusLabel: { ...typography.body, color: colors.text, flex: 1, fontSize: 13 },
  focusDetail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  questionBubble: {
    maxWidth: "82%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 18,
    borderTopRightRadius: 6,
    backgroundColor: "rgba(128,171,214,0.46)",
  },
  questionText: {
    ...typography.bodyStrong,
    color: colors.text,
    lineHeight: 22,
  },
  answerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  userAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  thinking: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  botAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
  },
  thinkingText: { ...typography.caption, color: colors.textSecondary },
  bottomSafe: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  bottomRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  bottomRowExpanded: {
    minHeight: 112,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  composer: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
  },
  composerExpanded: {
    minHeight: 96,
    borderRadius: 24,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  composerInputRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  composerToolsRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  addButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    paddingVertical: 7,
  },
  voiceButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  voiceButtonActive: { backgroundColor: colors.accentSoft },
  send: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.primary,
  },
  sendDisabled: { backgroundColor: "#AEB7C0" },
  voiceError: {
    fontSize: 10,
    lineHeight: 15,
    color: colors.danger,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  attachmentChip: {
    alignSelf: "center",
    maxWidth: "72%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  attachmentName: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.primary,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(31, 34, 31, 0.28)",
  },
  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 34,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.cardTitle, color: colors.text },
  sheetHint: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 3,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F1ED",
  },
  sheetAction: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetActionDisabled: { opacity: 0.58 },
  sheetActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  sheetActionCopy: { flex: 1 },
  sheetActionTitle: { ...typography.bodyStrong, color: colors.text },
  sheetActionDetail: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pendingBadge: {
    fontSize: 10,
    color: colors.textMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "#F0EFEB",
  },
  voiceScreen: { flex: 1 }, voiceScreenSafe: { flex: 1 },
  voiceHeader: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  voiceHeaderClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  voiceScreenTitle: { ...typography.bodyStrong, color: colors.text },
  voiceCenter: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: '16%' },
  voiceOuterRing: { width: 224, height: 224, borderRadius: 112, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(211,230,251,0.28)' },
  voiceInnerRing: { width: 174, height: 174, borderRadius: 87, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(211,230,251,0.48)' },
  voiceOrb: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  voiceWaveform: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceWaveBar: { width: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  voiceListening: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xl },
  voiceFooter: { height: 112, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl },
  voiceSideButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.74)' },
  voicePauseButton: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  voiceDoneButton: { minWidth: 54, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.78)' },
  voiceDoneText: { ...typography.caption, color: colors.text },
  askButton: {
    minHeight: 46,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  askButtonDisabled: { backgroundColor: colors.textMuted },
  askButtonText: { ...typography.bodyStrong, color: "#FFFFFF" },
  aiCard: {
    alignItems: "flex-start",
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aiIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text,
    marginTop: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  missingBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignSelf: "stretch",
  },
  missingItem: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  demoNotice: {
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
