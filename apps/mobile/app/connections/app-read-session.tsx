import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { appReadEventRequest, appReadHeartbeatRequest } from '../../src/app-read-session-api-contract';
import { useAuthStore } from '../../src/auth-store';
import {
  acknowledgeAppReadSessionEvents, appReadSessionStatus, drainAppReadSessionEvents, openDeviceApp,
  openUsageAccessSettings, openPageReadSettings, startNativeAppReadSession, stopNativeAppReadSession,
} from '../../src/device-app-bridge';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';
import { syncLocalCapabilities } from '../../src/local-capability-client';
import { resolveAppReadProfile } from '../../src/app-read-profiles';
import type { UiReadConsent } from '@lazy-armor/plan-schema/mobile';

interface AppReadSession {
  id: string; connectionId: string; targetPackage: string; modes: string[]; status: string;
  uiReadConsent?: UiReadConsent & { sourceVersion: string };
  startedAt: string | null; lastHeartbeatAt: string | null; expiresAt: string; endedAt: string | null;
  terminalReason: string | null; events: Array<{ id: string; eventKey: string; eventType: string; sourceMode: string | null; candidateFactId: string | null; createdAt: string }>;
}

export default function AppReadSessionPage() {
  const params = useLocalSearchParams<{ connectionId?: string; packageName?: string; displayName?: string; notificationEnabled?: string; mode?: string; conversationId?: string; messageId?: string; version?: string }>();
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const pageRead = params.mode === 'UI_READ';
  const goalRead = Boolean(params.conversationId || params.messageId || params.version);
  const validGoal = /^[0-9a-f-]{36}$/i.test(params.conversationId ?? '') && /^[0-9a-f-]{36}$/i.test(params.messageId ?? '') && /^\d+$/.test(params.version ?? '');
  const profile = params.packageName ? resolveAppReadProfile(params.packageName) : null;
  const [confirmed, setConfirmed] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const grant = useQuery({ queryKey: ['page-read-grant', token], enabled: Boolean(token && pageRead), queryFn: async () => {
    await syncLocalCapabilities(token!);
    const resources = await deviceBoundApi<Array<{ kind: string; capabilityState?: { key: string; availability: string } }>>('/consumer/resources', token!, { method: 'GET' });
    return resources.some(resource => resource.kind === 'LOCAL' && resource.capabilityState?.key === 'accessibility.read' && resource.capabilityState.availability === 'AVAILABLE');
  } });
  const current = useQuery({
    queryKey: ['app-read-session', token],
    queryFn: () => api<AppReadSession | null>('/app-read-sessions/current', token),
    enabled: Boolean(token), staleTime: 0,
  });
  const native = useQuery({ queryKey: ['native-app-read-session'], queryFn: appReadSessionStatus, staleTime: 0 });
  const goal = useQuery({ queryKey: ['goal-page-read', token, params.conversationId, params.messageId], enabled: Boolean(token && goalRead && validGoal), staleTime: 0,
    queryFn: () => api<{ pageReads: import('@lazy-armor/plan-schema/mobile').GoalPageReadResult[] }>('/conversations/' + params.conversationId, token),
    refetchInterval: 3000 });
  const goalResult = goal.data?.pageReads.find(result => result.messageId === params.messageId);
  const canResumeConfirmed = goalResult?.status === 'CONFIRMED' && !goalResult.deviceTaskId && goalResult.sessionId === current.data?.id;

  const sync = useMutation({
    mutationFn: async () => syncNativeEvents(token, current.data?.id ?? null),
    onSuccess: async () => {
      await Promise.all([current.refetch(), native.refetch(), client.invalidateQueries({ queryKey: ['mobile-notification-receipts', token] })]);
    },
  });
  useFocusEffect(useCallback(() => {
    void native.refetch();
    if (pageRead) void grant.refetch();
    let cancelled = false;
    void current.refetch().then(async (result) => {
      if (cancelled || !token || !result.data?.id) return;
      await syncNativeEvents(token, result.data.id);
      if (!cancelled) await Promise.all([current.refetch(), native.refetch()]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [token, pageRead]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void native.refetch();
      if (pageRead && token) void grant.refetch();
    });
    return () => subscription.remove();
  }, [token, pageRead, native.refetch, grant.refetch]);

  const start = useMutation({
    mutationFn: async () => {
      if (!token || !params.connectionId || !params.packageName) throw new Error('missing_connection');
      await ensureTrustedDevice(token);
      const accountId = await syncLocalCapabilities(token);
      if (pageRead && ((!confirmed && !canResumeConfirmed) || !profile)) throw new Error('请先确认页面读取范围');
      if (goalRead && (!pageRead || !validGoal)) throw new Error('请从原会话的资源建议重新打开');
      const modes = pageRead ? ['UI_READ'] : params.notificationEnabled === 'true' ? ['NOTIFICATION', 'SHARE'] : ['SHARE'];
      const body = { connectionId: params.connectionId, targetPackage: params.packageName, modes, durationSeconds: 300,
        ...(pageRead && profile ? { uiReadConsent: { version: 'ui-read.v1', requestedFields: [...profile.allowedSelectors] } } : {}) };
      const session = goalRead
        ? await deviceBoundApi<AppReadSession>(`/conversations/${params.conversationId}/messages/${params.messageId}/page-read/confirm`, token, { method: 'POST', body: JSON.stringify({ version: Number(params.version), connectionId: params.connectionId, confirmed: true }) })
        : await deviceBoundApi<AppReadSession>('/app-read-sessions', token, { method: 'POST', body: JSON.stringify(body) });
      if (!['CREATED', 'WAITING_FOREGROUND', 'READING'].includes(session.status)) return session;
      const nativeStarted = await startNativeAppReadSession(accountId, session.id, session.targetPackage, session.modes, session.expiresAt, session.uiReadConsent);
      const appOpened = nativeStarted && (pageRead || await openDeviceApp(session.targetPackage));
      if (!nativeStarted || !appOpened) {
        // A failed native start may belong to a different active scope. Preserve
        // the frozen Goal consent for a bounded retry instead of destroying it.
        if (nativeStarted) await stopNativeAppReadSession();
        if (!goalRead) await deviceBoundApi('/app-read-sessions/' + session.id + '/stop', token, { method: 'POST', body: '{}' }).catch(() => undefined);
        throw new Error(nativeStarted ? 'target_app_open_failed' : 'native_start_failed');
      }
      if (pageRead && profile) {
        try {
          const result = await api<{ acceptance: { deviceTaskId: string } }>('/structured-reads', token, { method: 'POST', body: JSON.stringify({ requestId: (goalRead ? 'goal-page-' : 'page-') + session.id, sourceType: 'DEVICE_APP', resourceType: profile.resourceType, resourceId: session.id, packageName: session.targetPackage, appReadSessionId: session.id, requestedFields: session.uiReadConsent!.requestedFields }) });
          setTaskId(result.acceptance.deviceTaskId);
        } catch (error) {
          // A lost enqueue response may already have committed the Task. Preserve
          // the frozen goal consent for an idempotent resume; expiry still bounds it.
          if (!goalRead) {
            await stopNativeAppReadSession();
            await deviceBoundApi('/app-read-sessions/' + session.id + '/stop', token, { method: 'POST', body: '{}' }).catch(() => undefined);
          }
          throw error;
        }
      }
      return session;
    },
    onSuccess: async () => { await Promise.all([current.refetch(), native.refetch(), goalRead ? goal.refetch() : Promise.resolve(), client.invalidateQueries({ queryKey: ['conversation'] })]); },
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
  const activeSession = session && ['CREATED', 'WAITING_FOREGROUND', 'READING'].includes(session.status);
  const canStart = Boolean(token && params.connectionId && params.packageName && native.data?.usageAccessGranted && !activeSession
    && (!goalRead || validGoal)
    && !goalResult
    && (!pageRead || (profile && confirmed && grant.data && native.data?.observerConnected && native.data?.observerPermissionGranted)));
  return <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <WorkspaceHeader title={pageRead ? '限时页面读取' : '受控读取会话'} onBack={() => router.canGoBack() ? router.back() : router.replace('/phone-apps' as never)} />
      <Text style={styles.subtitle}>{pageRead ? '核对本次应用和字段范围，确认后按次观察' : '只在目标应用位于前台时接收你允许的线索'}</Text>
      {goalRead && validGoal ? <Surface><Text style={styles.body}>本次读取属于原会话目标。核实后的结果会回到同一会话。</Text><ActionButton label="返回原会话" tone="quiet" onPress={() => router.replace({ pathname: '/chat', params: { conversationId: params.conversationId } } as never)} /></Surface> : null}
      {current.isLoading || native.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {!native.data?.usageAccessGranted ? <Surface>
        <View style={styles.cardHeading}><Ionicons name="shield-checkmark-outline" size={24} color={colors.warning} /><Text style={styles.cardTitle}>需要前台验证权限</Text></View>
        <Text style={styles.body}>Android 的“使用情况访问”仅用于核对当前前台包名。权限缺失时会话无法开始，不会降级为后台读取。</Text>
        <View style={styles.actions}><ActionButton label="打开系统设置" onPress={() => void openUsageAccessSettings()} /></View>
      </Surface> : null}
      {pageRead ? <Surface><Text style={styles.cardTitle}>页面读取授权</Text><Text style={styles.body}>系统权限：{native.data?.observerPermissionGranted ? '已开启' : '需要授权'} · 观察器：{native.data?.observerConnected ? '已连接' : '未连接'}</Text><Text style={styles.body}>应用内页面读取许可：{grant.data ? '已授权' : '需要授权'}。通知与分享许可不包含页面读取。</Text><View style={styles.actions}><ActionButton label="系统辅助功能设置" tone="quiet" onPress={() => void openPageReadSettings()} /><ActionButton label="管理页面读取许可" tone="quiet" onPress={() => router.push('/resources' as never)} /></View></Surface> : null}
      {activeSession && session ? <SessionPanel session={session} nativeStatus={native.data?.status ?? 'IDLE'} /> : <Surface>
        <View style={styles.cardHeading}><Ionicons name="phone-portrait-outline" size={24} color={colors.primary} /><Text style={styles.cardTitle}>{params.displayName ?? '目标应用'}</Text></View>
        <Text style={styles.package}>{params.packageName ?? '未选择应用'}</Text>
        <Text style={styles.body}>会话最长 5 分钟；离开目标应用、失去权限、心跳超时或主动停止都会立即收口。</Text>
        {pageRead ? <><Text style={styles.body}>本次范围：{params.packageName === 'com.miui.calculator' ? '计算器当前结果' : '已登记的页面字段'}。最多 5 分钟，读取一次；字段仅形成线索，仍需核实。</Text><View style={styles.modeRow}><Text style={styles.body}>我确认本次应用与读取范围</Text><Switch accessibilityLabel="确认本次页面读取范围" value={confirmed} onValueChange={setConfirmed} /></View></> : <View style={styles.modeRow}><Text style={styles.mode}>主动分享</Text>{params.notificationEnabled === 'true' ? <Text style={styles.mode}>已授权通知</Text> : null}</View>}
        <View style={styles.actions}><ActionButton label={start.isPending ? '正在启动…' : pageRead ? '确认并读取一次' : '启动并打开应用'} onPress={() => start.mutate()} disabled={!canStart || start.isPending} /></View>
      </Surface>}
      {activeSession ? <View style={styles.actions}><ActionButton label={sync.isPending ? '正在同步…' : '同步会话状态'} tone="quiet" onPress={() => sync.mutate()} disabled={sync.isPending} /><ActionButton label="停止会话" tone="danger" onPress={() => stop.mutate()} disabled={stop.isPending} /></View> : null}
      {canResumeConfirmed ? <ActionButton label={start.isPending ? '正在恢复…' : '继续已确认的读取'} disabled={start.isPending || !grant.data || !native.data?.observerConnected || !native.data?.usageAccessGranted} onPress={() => start.mutate()} /> : null}
      {taskId || goalResult?.deviceTaskId ? <Surface><Text style={styles.cardTitle}>本次读取</Text><Text style={styles.body}>返回后查看读取状态与待核实线索。</Text><ActionButton label="查看读取结果" onPress={() => router.push({ pathname: '/connections/device-tasks/[id]', params: { id: taskId ?? goalResult!.deviceTaskId! } } as never)} /></Surface> : null}
      {start.isError || sync.isError || stop.isError ? <Text style={styles.error}>本次操作未完成，请检查权限与来源后重试。</Text> : null}
      <Surface><Text style={styles.cardTitle}>读取边界</Text><Text style={styles.body}>{pageRead ? '系统辅助功能权限范围较广，应用内仅按你确认的 App、字段和限时会话读取。不会自动点击、输入、提交、截屏或读取密码。离开目标应用后停止采集。' : '本次只接收通知或主动分享，不读取页面。离开目标应用后停止采集。'}</Text></Surface>
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
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
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
