import { useQuery } from '@tanstack/react-query';
import { Link, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ShellPage, styles } from '../../src/shell';

interface Connection { id: string }
interface DeviceProfile { id: string }
interface VehicleProfile { id: string }
interface RecurringItemProfile { id: string }
interface MembershipSummary { membership: { name: string }; usage: { activePlans: number }; limits: { max_active_plans: number } }
interface UnreadCount { count: number }

export default function Me() {
  const token = useAuthStore((state) => state.token);
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['device-profiles', token], queryFn: () => api<DeviceProfile[]>('/device-profiles', token), enabled: Boolean(token) });
  const vehicles = useQuery({ queryKey: ['vehicle-profiles', token], queryFn: () => api<VehicleProfile[]>('/vehicle-profiles', token), enabled: Boolean(token) });
  const recurringItems = useQuery({ queryKey: ['recurring-item-profiles', token], queryFn: () => api<RecurringItemProfile[]>('/recurring-item-profiles', token), enabled: Boolean(token) });
  const membership = useQuery({ queryKey: ['membership', token], queryFn: () => api<MembershipSummary>('/me/membership', token), enabled: Boolean(token) });
  const unread = useQuery({ queryKey: ['notifications-unread', token], queryFn: () => api<UnreadCount>('/notifications/unread-count', token), enabled: Boolean(token) });
  const loading = connections.isLoading || devices.isLoading || vehicles.isLoading || recurringItems.isLoading || membership.isLoading || unread.isLoading;

  return (
    <ShellPage title="我的" subtitle="把连接、权限、设备、车辆和安全入口放到同一个地方，方便你自己管理。">
      {token && loading ? <ActivityIndicator style={local.loading} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>个人资料</Text>
        <Text style={styles.cardText}>{token ? '当前账号已登录，可以继续管理连接、权限和个人资料入口。' : '登录后才能查看你的连接、设备、车辆和通知。'}</Text>
      </View>

      <Link href="/connections" asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>我的连接</Text>
            <Text style={styles.cardText}>已连接 {connections.data?.length ?? 0} 个服务，支持查看状态、重新连接和断开账号。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/permissions' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>权限中心</Text>
            <Text style={styles.cardText}>从“能读取什么、能准备什么”来查看授权，并可逐项撤销，撤销后会立即生效。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/devices' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>我的设备</Text>
            <Text style={styles.cardText}>已记录 {devices.data?.length ?? 0} 台设备，可继续用于耗材提醒和维护类计划。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/vehicles' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>我的车辆</Text>
            <Text style={styles.cardText}>已记录 {vehicles.data?.length ?? 0} 台车辆，可继续用于保养、保险和年检提醒。</Text>
          </View>
        </Pressable>
      </Link>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>家庭</Text>
        <Text style={styles.cardText}>已记录 {recurringItems.data?.length ?? 0} 条周期事项，第一版先保留轻量入口，不做家庭社交系统。</Text>
      </View>

      <Link href={'/notification-settings' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>通知</Text>
            <Text style={styles.cardText}>还有 {unread.data?.count ?? 0} 条未读通知；现在可以真正设置异常、摘要和静默偏好。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/automation-safety' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>自动化安全等级</Text>
            <Text style={styles.cardText}>只提醒我、替我准备好、确认后执行等偏好已进入独立说明与设置页面。</Text>
          </View>
        </Pressable>
      </Link>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>隐私</Text>
        <Text style={styles.cardText}>只读取计划当前需要的最小数据；连接断开后，相关计划会立即失去对应权限。</Text>
      </View>

      <Link href={'/data-management' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>数据管理</Text>
            <Text style={styles.cardText}>现在可以查看你当前有哪些连接、资料、计划和记录，以及账户删除入口状态。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/security-activity' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>安全记录</Text>
            <Text style={styles.cardText}>已记录连接、权限和敏感操作的安全事实，现在可查看消费者安全投影。</Text>
          </View>
        </Pressable>
      </Link>

      <Link href={'/membership' as Href} asChild>
        <Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>会员</Text>
            <Text style={styles.cardText}>当前是 {membership.data?.membership.name ?? '免费版'}，已启用 {membership.data?.usage.activePlans ?? 0} / {membership.data?.limits.max_active_plans ?? 3} 个计划。</Text>
          </View>
        </Pressable>
      </Link>
    </ShellPage>
  );
}

const local = StyleSheet.create({
  loading: { marginBottom: 12 },
});
