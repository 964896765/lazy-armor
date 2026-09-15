import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, WorkspaceHeader } from './design';
import { lifecycleStateDetail, lifecycleStateLabel, lifecycleTone, type RuntimeLifecycleStep } from './runtime-details-presenter';

export function RuntimeDetailScreen({ title, subtitle, children, onBack = () => router.back() }: { title: string; subtitle: string; children: ReactNode; onBack?: () => void }) {
  return <SafeAreaView style={styles.safeArea} edges={['top']}><ScrollView style={styles.page} contentContainerStyle={styles.content}><WorkspaceHeader title={title} subtitle={subtitle} onBack={onBack} />{children}</ScrollView></SafeAreaView>;
}

export function RuntimeLoadState({ loading, error, empty, onRetry, loadingText = '正在读取真实记录…', emptyTitle = '暂无可显示记录', emptyDescription = '还没有可确认的数据。' }: { loading: boolean; error: boolean; empty?: boolean; onRetry?: () => void; loadingText?: string; emptyTitle?: string; emptyDescription?: string }) {
  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>{loadingText}</Text></View>;
  if (error) return <View style={styles.state}><Ionicons name="cloud-offline-outline" size={26} color={colors.warning} /><Text style={styles.stateTitle}>暂时无法读取</Text><Text style={styles.muted}>没有展示示例数据，也没有修改你的记录。</Text>{onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>重新加载</Text></Pressable> : null}</View>;
  if (empty) return <View style={styles.state}><Ionicons name="file-tray-outline" size={26} color={colors.textMuted} /><Text style={styles.stateTitle}>{emptyTitle}</Text><Text style={styles.muted}>{emptyDescription}</Text></View>;
  return null;
}

export function RuntimeCard({ title, children }: { title?: string; children: ReactNode }) { return <View style={styles.card}>{title ? <Text style={styles.cardTitle}>{title}</Text> : null}{children}</View>; }
export function RuntimeSection({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
export function RuntimeText({ children, emphasis = false }: { children: ReactNode; emphasis?: boolean }) { return <Text style={emphasis ? styles.bodyStrong : styles.body}>{children}</Text>; }

export function RuntimeKeyValue({ label, value, last = false }: { label: string; value: string | number | null | undefined; last?: boolean }) {
  return <View style={[styles.keyValue, !last && styles.divider]}><Text style={styles.key}>{label}</Text><Text selectable style={styles.value}>{value === null || value === undefined || value === '' ? '未记录' : String(value)}</Text></View>;
}

export function LifecycleTimeline({ steps }: { steps: RuntimeLifecycleStep[] }) {
  return <View style={styles.timeline}>{steps.map((step, index) => {
    const tone = lifecycleTone(step.state);
    return <View key={step.key} style={styles.timelineRow}><View style={styles.track}><View style={[styles.dot, dotStyle(tone)]}><Text style={styles.dotText}>{step.step}</Text></View>{index < steps.length - 1 ? <View style={styles.line} /> : null}</View><View style={[styles.timelineCopy, index < steps.length - 1 && styles.timelineDivider]}><View style={styles.timelineHeading}><Text style={styles.stepLabel}>{step.label}</Text><Text style={[styles.pill, pillStyle(tone)]}>{lifecycleStateLabel(step.state)}</Text></View><Text style={styles.stepDetail}>{lifecycleStateDetail(step.state, step.reason)}</Text></View></View>;
  })}</View>;
}

export function LoginRequired() { return <RuntimeCard title="请先登录"><RuntimeText>登录后才能读取仅属于你的运行详情、授权状态与事实来源。</RuntimeText><Pressable accessibilityRole="button" onPress={() => router.push('/auth/login' as never)} style={styles.retry}><Text style={styles.retryText}>去登录</Text></Pressable></RuntimeCard>; }

function dotStyle(tone: ReturnType<typeof lifecycleTone>) { return tone === 'success' ? styles.dotSuccess : tone === 'danger' ? styles.dotDanger : tone === 'warning' ? styles.dotWarning : tone === 'brand' ? styles.dotBrand : styles.dotMuted; }
function pillStyle(tone: ReturnType<typeof lifecycleTone>) { return tone === 'success' ? styles.pillSuccess : tone === 'danger' ? styles.pillDanger : tone === 'warning' ? styles.pillWarning : tone === 'brand' ? styles.pillBrand : styles.pillMuted; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1, backgroundColor: colors.surface }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 60 },
  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: 52, paddingHorizontal: spacing.lg }, stateTitle: { ...typography.section, color: colors.text }, muted: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 }, retry: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.accentSoft }, retryText: { ...typography.bodyStrong, color: colors.primary },
  section: { marginTop: spacing.xl }, sectionTitle: { ...typography.section, color: colors.text, marginBottom: spacing.sm }, card: { borderRadius: radius.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, padding: spacing.md }, cardTitle: { ...typography.cardTitle, color: colors.text, marginBottom: spacing.sm }, body: { ...typography.body, color: colors.textSecondary, lineHeight: 21 }, bodyStrong: { ...typography.bodyStrong, color: colors.text, lineHeight: 21 },
  keyValue: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, key: { ...typography.caption, color: colors.textSecondary, flex: 0.85 }, value: { ...typography.caption, color: colors.text, fontWeight: '700', flex: 1.15, textAlign: 'right' },
  timeline: { borderRadius: radius.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md }, timelineRow: { flexDirection: 'row', minHeight: 76 }, track: { width: 31, alignItems: 'center', position: 'relative' }, dot: { width: 23, height: 23, borderRadius: 12, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center', zIndex: 1 }, dotText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' }, dotSuccess: { backgroundColor: colors.success }, dotDanger: { backgroundColor: colors.danger }, dotWarning: { backgroundColor: colors.warning }, dotBrand: { backgroundColor: colors.primary }, dotMuted: { backgroundColor: colors.textMuted }, line: { position: 'absolute', top: 36, bottom: -10, width: 2, backgroundColor: colors.border }, timelineCopy: { flex: 1, minWidth: 0, paddingVertical: spacing.md, paddingLeft: spacing.sm }, timelineDivider: { borderBottomWidth: 1, borderBottomColor: colors.border }, timelineHeading: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' }, stepLabel: { ...typography.bodyStrong, color: colors.text, flex: 1 }, stepDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 }, pill: { fontSize: 9, lineHeight: 13, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' }, pillSuccess: { color: colors.success, backgroundColor: colors.successSoft }, pillDanger: { color: colors.danger, backgroundColor: colors.dangerSoft }, pillWarning: { color: colors.warning, backgroundColor: colors.warningSoft }, pillBrand: { color: colors.primary, backgroundColor: colors.accentSoft }, pillMuted: { color: colors.textSecondary, backgroundColor: '#EEF0F2' },
});
