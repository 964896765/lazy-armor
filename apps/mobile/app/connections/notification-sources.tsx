import { syncLocalCapabilities } from '../../src/local-capability-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { createMobileNotificationReceiptRequest } from '../../src/device-app-api-contract';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';
import { acknowledgeNotificationPreviews, deviceDiscoveryStatus, drainNotificationPreviews, notificationSourceStatus, openNotificationAccessSettings, setNotificationSourceEnabled } from '../../src/device-app-bridge';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, colors, spacing, typography } from '../../src/design';

interface DeviceAppConnection { id: string; trustedDeviceId: string | null; packageName: string; displayName: string; enabled: boolean; modes: string[] }
interface ReceiptResult { receiptId: string; duplicate: boolean; status: string }
interface PendingReceipt { id: string; connectionId: string; status: string; postedAt: string; receivedAt: string; candidateKind: 'unknown' | 'billing_transaction_candidate' | 'account_notification_candidate' | 'shipment_candidate' | 'bill_candidate' | 'device_candidate'; candidateStatus:string|null; candidateResource: 'mobile.billing.transaction' | 'mobile.account.notification' | 'shipment' | 'Bill' | 'DeviceStatus' | null; candidateConfidence: number; amountMinor: number | null; currency: 'CNY' | null }

export default function NotificationSourcesPage() {
  const params=useLocalSearchParams<{returnTo?:string}>();
  const returnTo=typeof params.returnTo==='string' && /^\/chat\?conversationId=[0-9a-f-]{36}$/i.test(params.returnTo)?params.returnTo:null;
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const nativeUnavailable = deviceDiscoveryStatus() === 'unavailable';
  const [pageFocused, setPageFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const refreshInterval = pageFocused && foreground ? 5000 : false;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const nativeStatus = useQuery({ queryKey: ['notification-source-status'], queryFn: notificationSourceStatus, enabled: Boolean(token), staleTime: 0, refetchInterval: refreshInterval, refetchIntervalInBackground: false });
  const connections = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const currentDevice = useQuery({ queryKey: ['current-trusted-device', token], queryFn: () => ensureTrustedDevice(token ?? null), enabled: Boolean(token) && !nativeUnavailable });
  const available = currentDevice.data ? (connections.data ?? []).filter(connection => connection.enabled && connection.trustedDeviceId === currentDevice.data.id) : [];
  const sourcesReady = currentDevice.isSuccess && connections.isSuccess;
  const sourcesError = currentDevice.isError || connections.isError;
  const pendingReceipts = useQuery({ queryKey: ['mobile-notification-receipts', token, currentDevice.data?.id], queryFn: () => api<PendingReceipt[]>('/device-app-connections/notification-receipts', token), select: receipts => receipts.filter(receipt => available.some(connection => connection.id === receipt.connectionId)), enabled: Boolean(token) && sourcesReady, refetchInterval: refreshInterval, refetchIntervalInBackground: false });
  useFocusEffect(useCallback(() => {
    setPageFocused(true);
    if (token) {
      void pendingReceipts.refetch();
      void syncLocalCapabilities(token).then(() => nativeStatus.refetch()).catch(() => {});
    }
    return () => setPageFocused(false);
  }, [token, nativeStatus.refetch, pendingReceipts.refetch]));

  const toggle = useMutation({
    mutationFn: async ({ connection, enabled }: { connection: DeviceAppConnection; enabled: boolean }) => {
      if (enabled) {
        const localUpdated = await setNotificationSourceEnabled(connection.packageName, true);
        if (!localUpdated) throw new Error('local_update_failed');
        try {
          return await api<DeviceAppConnection>(`/device-app-connections/${connection.id}`, token, { method: 'PATCH', body: JSON.stringify({ modes: [...new Set([...connection.modes, 'notification_read'])] }) });
        } catch (error) {
          await setNotificationSourceEnabled(connection.packageName, false);
          throw error;
        }
      }
      await setNotificationSourceEnabled(connection.packageName, false);
      return api<DeviceAppConnection>(`/device-app-connections/${connection.id}`, token, { method: 'PATCH', body: JSON.stringify({ modes: connection.modes.filter((mode) => mode !== 'notification_read') }) });
    },
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['device-app-connections', token] }), nativeStatus.refetch()]);
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      if (!sourcesReady) throw new Error('CURRENT_DEVICE_SOURCES_REQUIRED');
      const byPackage = new Map(available.filter(connection => connection.modes.includes('notification_read')).map(connection => [connection.packageName, connection]));
      const pending = await drainNotificationPreviews();
      const acknowledged: string[] = [];
      for (const preview of pending) {
        const connection = byPackage.get(preview.sourcePackage);
        const request = createMobileNotificationReceiptRequest(preview);
        if (!connection || !request) continue;
        const result = await deviceBoundApi<ReceiptResult>(`/device-app-connections/${connection.id}/notification-receipts`, token ?? null, { method: 'POST', body: JSON.stringify(request) });
        if (result.receiptId) acknowledged.push(preview.eventId);
      }
      await acknowledgeNotificationPreviews(acknowledged);
      return acknowledged.length;
    },
    onSettled: async () => {
      // Some receipts may already be committed even when a later upload fails.
      // Display server candidates without treating synchronization as Truth.
      await Promise.all([nativeStatus.refetch(), client.invalidateQueries({ queryKey: ['mobile-notification-receipts', token] }), client.invalidateQueries({ queryKey: ['today', token] }), client.invalidateQueries({ queryKey: ['notifications', token] })]);
    },
  });

  const decideReceipt = useMutation({
    mutationFn: ({ receipt, confirmed }: { receipt: PendingReceipt; confirmed: boolean }) => api(`/device-app-connections/${receipt.connectionId}/notification-receipts/${receipt.id}/verify`, token, { method: 'POST', body: JSON.stringify({ confirmed }) }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['mobile-notification-receipts', token] }), client.invalidateQueries({ queryKey: ['today', token] }), client.invalidateQueries({ queryKey: ['notifications', token] })]);
    },
  });
  return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.pageHeader}><WorkspaceHeader title="通知来源" onBack={() => router.canGoBack() ? router.back() : router.replace('/resources' as never)} /></View><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.subtitle}>逐个选择已添加的应用。通知正文只在手机上短暂处理，系统只会同步最小化指纹线索等待核实。</Text></View>
    {!token ? <Surface><EmptyState icon="log-in-outline" title="请先登录" description="需要先确认当前账号，才能管理通知来源。" /></Surface> : null}
    {token && nativeUnavailable ? <Surface><EmptyState icon="notifications-off-outline" title="暂时无法管理通知来源" description="请使用包含原生模块的 Android 构建。Web、iOS 或 Expo Go 不会假装已经获得系统通知访问。" /></Surface> : null}
    {token && !nativeUnavailable ? <>
      {nativeStatus.data?.acquisitionEnabled===false ? <Surface><Text style={styles.cardTitle}>消息获取已暂停</Text><Text style={styles.cardCopy}>开启通知访问和应用来源后，还需要开启消息获取，才能读取真实通知。</Text><View style={styles.action}><ActionButton label="管理消息获取" onPress={()=>router.push('/settings' as never)}/></View></Surface> : null}
      {nativeStatus.data?.accessGranted && nativeStatus.data.acquisitionEnabled !== false && nativeStatus.data.connected === false ? <Surface><Text style={styles.cardTitle}>通知监听尚未连接</Text><Text style={styles.cardCopy}>系统权限已开启，但当前还不能读取通知。请在系统通知访问设置中检查连接，恢复后原目标会自动继续。</Text><View style={styles.action}><ActionButton label="打开系统设置" onPress={() => void openNotificationAccessSettings()} /></View></Surface> : null}
      {!nativeStatus.data?.accessGranted ? <Surface><Text style={styles.cardTitle}>需要系统通知访问</Text><Text style={styles.cardCopy}>系统会单独询问是否允许懒人装甲读取通知。开启系统访问后，你仍需要在此页为每个应用分别选择是否作为来源。</Text><View style={styles.action}><ActionButton label="打开系统设置" onPress={() => void openNotificationAccessSettings()} /></View></Surface> : null}
      {nativeStatus.data?.accessGranted ? <Surface><Text style={styles.cardTitle}>已获得系统通知访问</Text><Text style={styles.cardCopy}>当前已有 {nativeStatus.data.enabledPackageCount} 个应用被你选为来源。未启用的应用不会采集或同步通知。</Text>{nativeStatus.data.pendingCount > 0 ? <View style={styles.action}><ActionButton label={sync.isPending ? '正在同步…' : `同步 ${nativeStatus.data.pendingCount} 条待核实线索`} onPress={() => sync.mutate()} disabled={sync.isPending} /></View> : <Text style={styles.quietText}>当前没有待同步的通知线索。</Text>}{sync.isError ? <Text style={styles.error}>同步暂时失败，未确认的线索会保留在本机等待你稍后重试。</Text> : null}</Surface> : null}
      <View style={styles.action}><ActionButton label="管理本机通知读取授权" tone="quiet" onPress={()=>router.push('/resources' as never)}/>{returnTo?<ActionButton label="返回原查询" onPress={()=>router.replace(returnTo as never)}/>:null}</View><Text style={styles.sectionTitle}>已添加的应用</Text>
      {connections.isLoading || currentDevice.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {sourcesError ? <><Text style={styles.error}>本机来源暂时无法加载。确认当前设备后才能管理通知读取。</Text><View style={styles.action}><ActionButton label="重试读取本机来源" tone="quiet" onPress={() => void Promise.all([currentDevice.refetch(), connections.refetch()])} disabled={currentDevice.isFetching || connections.isFetching} /></View></> : null}
      {sourcesReady && available.length === 0 ? <Surface><EmptyState icon="add-circle-outline" title="还没有可管理的应用" description="请先从当前设备的真实可启动应用中添加连接。" /></Surface> : null}
      <View style={styles.list}>{available.map((connection) => <NotificationSourceRow key={connection.id} connection={connection} accessGranted={Boolean(nativeStatus.data?.accessGranted)} pending={toggle.isPending} onToggle={(enabled) => toggle.mutate({ connection, enabled })} />)}</View>
      {toggle.isError ? <Text style={styles.error}>设置暂时没有保存。系统不会在未明确启用时上传通知。</Text> : null}
      <Text style={styles.sectionTitle}>待确认的资源线索</Text>
      {pendingReceipts.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {pendingReceipts.isError ? <><Text style={styles.error}>线索暂时无法加载，这不能说明没有待核实信息。</Text><View style={styles.action}><ActionButton label="重试读取线索" tone="quiet" onPress={() => void pendingReceipts.refetch()} disabled={pendingReceipts.isFetching} /></View></> : null}
      {sourcesReady && !pendingReceipts.isLoading && !pendingReceipts.isError && (pendingReceipts.data?.length ?? 0) === 0 ? <Text style={styles.quietText}>当前没有等待确认的线索。</Text> : null}
      <View style={styles.list}>{pendingReceipts.data?.map((receipt) => <PendingReceiptCard key={receipt.id} receipt={receipt} pending={decideReceipt.isPending} onDecide={(confirmed) => decideReceipt.mutate({ receipt, confirmed })} />)}</View>
      {decideReceipt.isError ? <Text style={styles.error}>这次确认没有保存。系统不会把线索当作真实事实；你可以稍后重试。</Text> : null}
      <View style={styles.action}><ActionButton label="查看已验证事实" tone="quiet" onPress={() => router.push('/truth-store' as never)} /></View>
      <Text style={styles.safetyText}>已同步的线索不会直接驱动账单、订单或其他自动操作。只有你明确确认且服务端验证语义一致时，品牌中立资源事实才会写入；计划仍需独立检查资源要求。</Text>
    </> : null}
  </ScrollView></SafeAreaView>;
}

function PendingReceiptCard({ receipt, pending, onDecide }: { receipt: PendingReceipt; pending: boolean; onDecide: (confirmed: boolean) => void }) {
  const label = receipt.candidateKind === 'shipment_candidate' ? `物流候选：${({IN_TRANSIT:'运输或派送中',DELIVERED:'通知提示已送达或签收',EXCEPTION:'物流异常',READY_FOR_PICKUP:'待取件'} as Record<string,string>)[receipt.candidateStatus??'']??'需要核实'}` : receipt.candidateKind === 'billing_transaction_candidate'
    ? `金额候选${receipt.amountMinor !== null ? `：${formatMoney(receipt.amountMinor, receipt.currency)}` : ''}`
    : receipt.candidateKind === 'account_notification_candidate' ? '账号提醒候选' : '未归类通知线索';
  const shipment=receipt.candidateKind==='shipment_candidate'&&receipt.candidateResource==='shipment'&&!!receipt.candidateStatus;
  const confirmable = shipment || receipt.candidateKind === 'billing_transaction_candidate' && receipt.candidateResource === 'mobile.billing.transaction' && receipt.amountMinor !== null && receipt.currency === 'CNY';
  return <Surface><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowDescription}>来源已授权；端侧分类置信度 {receipt.candidateConfidence}%。收到时间：{formatTime(receipt.postedAt)}。</Text>{confirmable ? <View style={styles.receiptActions}><ActionButton label={pending ? '正在保存…' : '确认这条资源事实'} onPress={() => onDecide(true)} disabled={pending} /><ActionButton label="不是这项事实" tone="quiet" onPress={() => onDecide(false)} disabled={pending} /></View> : <Text style={styles.quietText}>无法自动验证的线索不会被写入资源事实。你可以停止该来源，或忽略此线索。</Text>}</Surface>;
}

function formatMoney(amountMinor: number, currency: 'CNY' | null) { return currency === 'CNY' ? `¥${(amountMinor / 100).toFixed(2)}` : '金额不可用'; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN'); }

function NotificationSourceRow({ connection, accessGranted, pending, onToggle }: { connection: DeviceAppConnection; accessGranted: boolean; pending: boolean; onToggle: (enabled: boolean) => void }) {
  const enabled = connection.modes.includes('notification_read');
  return <Surface><View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{connection.displayName}</Text><Text style={styles.rowDescription}>{enabled ? '已允许作为通知来源；收到的线索仍会等待核实。' : '尚未允许读取通知。'}</Text></View><ActionButton label={enabled ? '停止读取' : '允许读取'} tone={enabled ? 'quiet' : 'primary'} onPress={() => onToggle(!enabled)} disabled={pending || !accessGranted} /></View></Surface>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, pageHeader: { paddingHorizontal: spacing.page }, page: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.page, paddingTop: spacing.md, paddingBottom: 48, gap: spacing.md }, header: { marginBottom: spacing.lg }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 22 }, cardTitle: { ...typography.cardTitle, color: colors.text }, cardCopy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 }, action: { alignItems: 'flex-start', marginTop: spacing.lg }, quietText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md }, sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs }, list: { gap: spacing.md }, receiptActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, rowCopy: { flex: 1 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 }, error: { ...typography.caption, color: colors.danger, lineHeight: 18 }, safetyText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.md },
});
