import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { appReadEventRequest, appReadHeartbeatRequest } from '../../src/app-read-session-api-contract';
import { useAuthStore } from '../../src/auth-store';
import {
  acknowledgeAppReadSessionEvents, appReadSessionStatus, drainAppReadSessionEvents, openDeviceApp,
  openUsageAccessSettings, startNativeAppReadSession, stopNativeAppReadSession,
} from '../../src/device-app-bridge';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';

interface AppReadSession {
  id: string; connectionId: string; targetPackage: string; modes: string[]; status: string;
  startedAt: string | null; lastHeartbeatAt: string | null; expiresAt: string; endedAt: string | null;
  terminalReason: string | null; events: Array<{ id: string; eventKey: string; eventType: string; sourceMode: string | null; candidateFactId: string | null; createdAt: string }>;
}

export default function AppReadSessionPage() {
  const params = useLocalSearchParams<{ connectionId?: string; packageName?: string; displayName?: string; notificationEnabled?: string }>();
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const current = useQuery({
    queryKey: ['app-read-session', token],
    queryFn: () => api<AppReadSession | null>('/app-read-sessions/current', token),
    enabled: Boolean(token), staleTime: 0,
  });
  const native = useQuery({ queryKey: ['native-app-read-session'], queryFn: appReadSessionStatus, staleTime: 0 });

  const sync = useMutation({
    mutationFn: async () => syncNativeEvents(token, current.data?.id ?? null),
    onSuccess: async () => {
      await Promise.all([current.refetch(), native.refetch(), client.invalidateQueries({ queryKey: ['mobile-notification-receipts', token] })]);
    },
  });
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void current.refetch().then(async (result) => {
      if (cancelled || !token || !result.data?.id) return;
      await syncNativeEvents(token, result.data.id);
      if (!cancelled) await Promise.all([current.refetch(), native.refetch()]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [token]));

  const start = useMutation({
    mutationFn: async () => {
      if (!token || !params.connectionId || !params.packageName) throw new Error('missing_connection');
      await ensureTrustedDevice(token);
      const modes = params.notificationEnabled === 'true' ? ['NOTIFICATION', 'SHARE'] : ['SHARE'];
      const body = { connectionId: params.connectionId, targetPackage: params.packageName, modes, durationSeconds: 300 };
      const session = await deviceBoundApi<AppReadSession>('/app-read-sessions', token, { method: 'POST', body: JSON.stringify(body) });
      const nativeStarted = await startNativeAppReadSession(session.id, session.targetPackage, session.modes, session.expiresAt);
      const appOpened = nativeStarted && await openDeviceApp(session.targetPackage);
      if (!nativeStarted || !appOpened) {
        await stopNativeAppReadSession();
        await deviceBoundApi('/app-read-sessions/' + session.id + '/stop', token, { method: 'POST', body: '{}' }).catch(() => undefined);
        throw new Error(nativeStarted ? 'target_app_open_failed' : 'native_start_failed');
      }
      return session;
    },
    onSuccess: async () => { await Promise.all([current.refetch(), native.refetch()]); },
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (!token || !current.data) return null;
      await stopNativeAppReadSession();
      return deviceBoundApi<AppReadSession>('/app-read-sessions/' + current.data.id + '/stop', token, { method: 'POST', body: '{}' });
    },
    onSuccess: async () => { await Promise.all([current.refetch(), native.refetch()]); },
  });

  const session = current.data;
  const canStart = Boolean(token && params.connectionId && params.packageName && native.data?.usageAccessGranted && !session);
  return <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <ActionButton label="返回" tone="quiet" onPress={() => router.back()} />
        <View style={styles.headerCopy}><Text style={styles.title}>受控读取会话</Text><Text style={styles.subtitle}>只在目标应用位于前台时接收你允许的线索</Text></View>
      </View>
      {current.isLoading || native.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {!native.data?.usageAccessGranted ? <Surface>
        <View style={styles.cardHeading}><Ionicons name="shield-checkmark-outline" size={24} color={colors.warning} /><Text style={styles.cardTitle}>需要前台验证权限</Text></View>
        <Text style={styles.body}>Android 的“使用情况访问”仅用于核对当前前台包名。权限缺失时会话无法开始，不会降级为后台读取。</Text>
        <View style={styles.actions}><ActionButton label="打开系统设置" onPress={() => void openUsageAccessSettings()} /></View>
      </Surface> : null}
      {session ? <SessionPanel session={session} nativeStatus={native.data?.status ?? 'IDLE'} /> : <Surface>
        <View style={styles.cardHeading}><Ionicons name="phone-portrait-outline" size={24} color={colors.primary} /><Text style={styles.cardTitle}>{params.displayName ?? '目标应用'}</Text></View>
        <Text style={styles.package}>{params.packageName ?? '未选择应用'}</Text>
        <Text style={styles.body}>会话最长 5 分钟；离开目标应用、失去权限、心跳超时或主动停止都会立即收口。</Text>
        <View style={styles.modeRow}><Text style={styles.mode}>主动分享</Text>{params.notificationEnabled === 'true' ? <Text style={styles.mode}>已授权通知</Text> : null}</View>
        <View style={styles.actions}><ActionButton label={start.isPending ? '正在启动…' : '启动并打开应用'} onPress={() => start.mutate()} disabled={!canStart || start.isPending} /></View>
      </Surface>}
      {session ? <View style={styles.actions}><ActionButton label={sync.isPending ? '正在同步…' : '同步会话事件'} tone="quiet" onPress={() => sync.mutate()} disabled={sync.isPending} /><ActionButton label="停止会话" tone="danger" onPress={() => stop.mutate()} disabled={stop.isPending} /></View> : null}
      {start.isError || sync.isError || stop.isError ? <Text style={styles.error}>本次操作未完成。系统保持 fail-closed，不会把未验证线索写成事实。</Text> : null}
      <Surface><Text style={styles.cardTitle}>明确边界</Text><Text style={styles.body}>不使用 Accessibility，不自动点击，不截屏，不做视觉识别，也不在目标应用离开前台后继续采集。通知与分享只生成候选，仍需进入 Generic Reality Pipeline 核实。</Text></Surface>
    </ScrollView>
  </SafeAreaView>;
}

function SessionPanel({ session, nativeStatus }: { session: AppReadSession; nativeStatus: string }) {
  const active = ['CREATED', 'WAITING_FOREGROUND', 'READING'].includes(session.status);
  return <>
    <Surface>
      <View style={styles.cardHeading}><Ionicons name={active ? 'radio-outline' : 'stop-circle-outline'} size={25} color={active ? colors.primary : colors.textMuted} /><Text style={styles.cardTitle}>{statusLabel(session.status)}</Text></View>
      <Text style={styles.package}>{session.targetPackage}</Text>
      <View style={styles.metricRow}><Metric label="原生状态" value={nativeStatus} /><Metric label="剩余时间" value={remaining(session.expiresAt)} /><Metric label="事件" value={String(session.events.length)} /></View>
      {session.terminalReason ? <Text style={styles.error}>收口原因：{session.terminalReason}</Text> : null}
    </Surface>
    <Text style={styles.sectionTitle}>会话事件</Text>
    {session.events.length === 0 ? <Surface><EmptyState icon="hourglass-outline" title="等待目标应用进入前台" description="系统正在核对包名；尚未读取任何内容。" /></Surface> : session.events.slice().reverse().map((event) => <Surface key={event.id}>
      <View style={styles.eventRow}><View><Text style={styles.eventTitle}>{eventLabel(event.eventType)}</Text><Text style={styles.eventTime}>{new Date(event.createdAt).toLocaleString('zh-CN')}</Text></View>{event.candidateFactId ? <Text style={styles.mode}>已生成候选</Text> : null}</View>
    </Surface>)}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function statusLabel(status: string) { return ({ WAITING_FOREGROUND: '等待目标应用', READING: '正在受控读取', APP_LEFT_FOREGROUND: '应用已离开前台', TIMEOUT: '会话已超时', CANCELLED: '会话已停止', FAILED: '安全检查未通过' } as Record<string, string>)[status] ?? status; }
function eventLabel(type: string) { return ({ SESSION_STARTED: '会话已启动', FOREGROUND_CONFIRMED: '目标应用已在前台', HEARTBEAT: '前台心跳正常', NOTIFICATION_CAPTURED: '收到通知候选', SHARE_CAPTURED: '收到主动分享候选', FOREGROUND_LOST: '目标应用离开前台', SESSION_STOPPED: '会话已停止', SESSION_TIMED_OUT: '会话已超时', NATIVE_ERROR: '原生安全检查失败' } as Record<string, string>)[type] ?? type; }
function remaining(expiresAt: string) { const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)); return seconds > 60 ? Math.ceil(seconds / 60) + ' 分钟' : seconds + ' 秒'; }

async function syncNativeEvents(token: string | null | undefined, expectedSessionId: string | null) {
  if (!token || !expectedSessionId) return 0;
  const events = await drainAppReadSessionEvents();
  const accepted: string[] = [];
  for (const event of events) {
    if (expectedSessionId && event.sessionId !== expectedSessionId) continue;
    try {
      const heartbeat = appReadHeartbeatRequest(event);
      if (heartbeat) {
        await deviceBoundApi('/app-read-sessions/' + event.sessionId + '/heartbeat', token, { method: 'POST', body: JSON.stringify(heartbeat) });
      } else {
        const request = appReadEventRequest(event);
        if (!request) continue;
        await deviceBoundApi('/app-read-sessions/' + event.sessionId + '/events', token, { method: 'POST', body: JSON.stringify(request) });
      }
      accepted.push(event.eventKey);
    } catch { break; }
  }
  await acknowledgeAppReadSessionEvents(accepted);
  return accepted.length;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.lg, paddingBottom: 48, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  headerCopy: { flex: 1 },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.cardTitle, color: colors.text },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.sm },
  package: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  mode: { ...typography.caption, color: colors.primary, backgroundColor: colors.accentSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  metricRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  metric: { flex: 1, backgroundColor: colors.pressed, padding: spacing.md, borderRadius: radius.md },
  metricValue: { ...typography.bodyStrong, color: colors.text }, metricLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.md },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  eventTitle: { ...typography.bodyStrong, color: colors.text }, eventTime: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.danger, lineHeight: 19, marginTop: spacing.sm },
});
