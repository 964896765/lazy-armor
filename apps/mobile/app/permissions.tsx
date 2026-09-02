import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { capabilityDescription, capabilityLabel, connectionStatusLabel, providerReadinessLabel } from '../src/connection-presenter';
import { ShellPage, styles } from '../src/shell';

interface Connection {
  id: string;
  connectorId: string;
  connectorName: string;
  externalAccountName: string;
  status: string;
}

interface Connector {
  key: string;
  productionStatus: string;
}

interface Permission {
  capability: string;
  name: string;
  granted: boolean;
}

interface ConnectionPlanUsage {
  planId: string;
  planName: string;
  requiredCapabilities: string[];
}

type PermissionSection = '可以读取' | '可以替你准备' | '可以对外执行';

export default function PermissionsPage() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const connections = useQuery({ queryKey: ['permission-connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const connectors = useQuery({ queryKey: ['permission-connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connectorByKey = new Map((connectors.data ?? []).map((item) => [item.key, item]));
  const detailQueries = useQueries({
    queries: (connections.data ?? []).map((connection) => ({
      queryKey: ['permission-detail', connection.id],
      queryFn: async () => ({
        connectionId: connection.id,
        permissions: await api<Permission[]>(`/connections/${connection.id}/permissions`, token),
        plans: await api<ConnectionPlanUsage[]>(`/connections/${connection.id}/plans`, token),
      }),
      enabled: Boolean(token),
    })),
  });
  const update = useMutation({
    mutationFn: (input: { connectionId: string; capability: string; granted: boolean }) => api(`/connections/${input.connectionId}/permissions`, token, {
      method: 'PUT',
      body: JSON.stringify({ permissions: [{ capability: input.capability, granted: input.granted }] }),
    }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['permission-detail', variables.connectionId] });
      void queryClient.invalidateQueries({ queryKey: ['connections', token] });
    },
  });

  const sections: Record<PermissionSection, Array<{
    connectionId: string;
    connectorId: string;
    connectorName: string;
    connectionStatus: string;
    readiness: string;
    capability: string;
    capabilityName: string;
    granted: boolean;
    plans: string[];
  }>> = { 可以读取: [], 可以替你准备: [], 可以对外执行: [] };

  for (const connection of connections.data ?? []) {
    const detail = detailQueries.find((item) => item.data?.connectionId === connection.id)?.data;
    const plans = detail?.plans ?? [];
    for (const permission of detail?.permissions ?? []) {
      const section = permissionSection(permission.capability);
      sections[section].push({
        connectionId: connection.id,
        connectorId: connection.connectorId,
        connectorName: connection.connectorName,
        connectionStatus: connection.status,
        readiness: connectorByKey.get(connection.connectorId)?.productionStatus ?? 'DISABLED',
        capability: permission.capability,
        capabilityName: permission.name,
        granted: permission.granted,
        plans: plans.filter((plan) => plan.requiredCapabilities.includes(permission.capability)).map((plan) => plan.planName),
      });
    }
  }

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="权限中心" subtitle="从你授予了什么来查看，而不是从连接列表里一项项翻。撤销后，相关计划会立即使用新的权限状态。">
        {connections.isLoading && <ActivityIndicator />}
        {(['可以读取', '可以替你准备', '可以对外执行'] as PermissionSection[]).map((section) => (
          <View key={section}>
            <Text style={local.section}>{section}</Text>
            {sections[section].length === 0 ? <Text style={local.empty}>这一组当前还没有能力。</Text> : null}
            {sections[section].map((item) => (
              <View style={styles.card} key={`${item.connectionId}:${item.capability}`}>
                <Text style={styles.cardTitle}>{capabilityLabel(item.connectorId, item.capability, item.capabilityName)}</Text>
                <Text style={styles.cardText}>{item.connectorName} · {item.granted ? '已授权' : '未授权'} · {connectionStatusLabel(item.connectionStatus)}</Text>
                <Text style={styles.cardText}>服务可用性：{providerReadinessLabel(item.readiness)}</Text>
                <Text style={styles.cardText}>{capabilityDescription(item.connectorId, item.capability)}</Text>
                <Text style={styles.cardText}>{item.plans.length > 0 ? `正在使用的计划：${item.plans.join('、')}` : '当前没有运行中的计划在使用它。'}</Text>
                <View style={local.action}>
                  <Button
                    title={item.granted ? '撤销' : '重新授权'}
                    color={item.granted ? '#A63D3D' : undefined}
                    onPress={() => update.mutate({ connectionId: item.connectionId, capability: item.capability, granted: !item.granted })}
                    disabled={update.isPending}
                  />
                </View>
              </View>
            ))}
          </View>
        ))}
      </ShellPage>
    </ScrollView>
  );
}

function permissionSection(capability: string): PermissionSection {
  if (capability.startsWith('READ_') || capability === 'MANUAL_INPUT' || capability === 'RECEIVE_WEBHOOK') return '可以读取';
  if (capability.includes('DRAFT') || capability.includes('PREPARE') || capability.includes('ARCHIVE') || capability.includes('STORE')) return '可以替你准备';
  return '可以对外执行';
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  section: { fontSize: 19, fontWeight: '800', color: '#24342C', marginBottom: 10 },
  empty: { color: '#6B7770', marginBottom: 12 },
  action: { marginTop: 12 },
});
