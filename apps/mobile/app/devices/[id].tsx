import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { listDeviceTasks, type DeviceTask } from '../../src/device-task-client';
import { deviceTaskStatusLabel } from '../../src/device-task-presenter';
import { ActionButton } from '../../src/design';
import { displayTime } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface TrustedDevice {
  id: string; deviceId: string; trustLevel: string; status: 'active' | 'revoked'; lastProvedAt: string; revokedAt: string | null;
  online: boolean; onlineState: string; lastHeartbeatAt: string | null;
}
interface DeviceAppConnection { id: string; trustedDeviceId: string | null; displayName: string; packageName: string; versionName: string | null; enabled: boolean; modes: string[]; lastSeenAt: string | null }
interface AppReadSession { id: string; trustedDeviceId: string; targetPackage: string; modes: string[]; status: string; lastHeartbeatAt: string | null; expiresAt: string; terminalReason: string | null }

export default function TrustedDeviceDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const devices = useQuery({ queryKey: ['trusted-devices', token], queryFn: () => api<TrustedDevice[]>('/trusted-devices', token), enabled: Boolean(token && id) });
  const connections = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token && id) });
  const session = useQuery({ queryKey: ['app-read-session-current', token], queryFn: () => api<AppReadSession | null>('/app-read-sessions/current', token), enabled: Boolean(token && id) });
  const tasks = useQuery({ queryKey: ['device-tasks', token], queryFn: () => listDeviceTasks(token!), enabled: Boolean(token && id), staleTime: 0 });
  const device = devices.data?.find((item) => item.id === id);
  const boundConnections = connections.data?.filter((item) => item.trustedDeviceId === id) ?? [];
  const recentTasks = (tasks.data ?? []).filter((item) => item.trustedDeviceId === id).slice(0, 5);
  const activeSession = session.data?.trustedDeviceId === id ? session.data : null;
  const loading = devices.isLoading || connections.isLoading;
  const error = devices.isError || connections.isError;

  return <RuntimeDetailScreen title="设备详情" subtitle="查看这台手机当前真实上报的连接、会话与任务" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={loading} error={error} empty={!loading && !error && !device} onRetry={() => Promise.all([devices.refetch(), connections.refetch()])} loadingText="正在核对设备状态…" emptyTitle="找不到这台设备" emptyDescription="设备可能已被移除，或不属于当前账号。" /> : null}
    {device ? <>
      <RuntimeSection title="当前状态"><RuntimeCard>
        <RuntimeKeyValue label="设备" value={device.deviceId} />
        <RuntimeKeyValue label="信任状态" value={device.status === 'active' ? '已验证' : '已撤销'} />
        <RuntimeKeyValue label="在线状态" value={device.online ? '在线' : '离线或心跳已过期'} />
        <RuntimeKeyValue label="最近心跳" value={device.lastHeartbeatAt ? displayTime(device.lastHeartbeatAt) : '尚未上报'} />
        <RuntimeKeyValue label="最近安全证明" value={displayTime(device.lastProvedAt)} last />
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="已授权的应用能力"><RuntimeCard>{boundConnections.length === 0 ? <RuntimeText>这台设备还没有应用连接。</RuntimeText> : boundConnections.map((item) => <RuntimeCard key={item.id} title={item.displayName}>
        <RuntimeKeyValue label="安装标识" value={item.packageName} />
        <RuntimeKeyValue label="应用版本" value={item.versionName || '未上报'} />
        <RuntimeKeyValue label="用户授权" value={item.enabled ? item.modes.join('、') : '已停用'} />
        <RuntimeKeyValue label="最近出现" value={item.lastSeenAt ? displayTime(item.lastSeenAt) : '尚未上报'} last />
      </RuntimeCard>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="最近读取会话"><RuntimeCard>{activeSession ? <>
        <RuntimeKeyValue label="目标应用" value={activeSession.targetPackage} />
        <RuntimeKeyValue label="状态" value={activeSession.status} />
        <RuntimeKeyValue label="读取方式" value={activeSession.modes.join('、')} />
        <RuntimeKeyValue label="最近心跳" value={activeSession.lastHeartbeatAt ? displayTime(activeSession.lastHeartbeatAt) : '尚未上报'} />
        <RuntimeKeyValue label="到期时间" value={displayTime(activeSession.expiresAt)} last />
      </> : <RuntimeText>当前没有这台设备的活动读取会话。</RuntimeText>}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="最近手机任务"><RuntimeCard>{tasks.isError ? <RuntimeText>当前手机无法读取任务列表；不会将它显示为可用。</RuntimeText> : recentTasks.length === 0 ? <RuntimeText>还没有分配给这台设备的任务。</RuntimeText> : recentTasks.map((task: DeviceTask) => <RuntimeCard key={task.id} title={task.taskType}>
        <RuntimeKeyValue label="状态" value={deviceTaskStatusLabel(task.status)} />
        <ActionButton label="查看任务与证据" tone="quiet" onPress={() => router.push(`/connections/device-tasks/${task.id}`)} />
      </RuntimeCard>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="安全边界"><RuntimeCard><RuntimeText>{device.status === 'active' ? '撤销设备后，旧的签名会话和后续任务必须拒绝执行。平台版本目前未由设备上报，因此不会显示猜测值。' : '设备已撤销；旧会话不得继续产生证据。'}</RuntimeText><ActionButton label="管理可信设备" tone="quiet" onPress={() => router.push('/connections/trusted-devices')} /></RuntimeCard></RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}
