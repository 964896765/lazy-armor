import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { AuthGate } from '../src/auth-gate';
import { useAuthStore } from '../src/auth-store';
import { useAuthSessionRefresh } from '../src/auth-session-refresh';
import { colors } from '../src/design';
import { useDeviceTaskRunnerLifecycle } from '../src/device-task-lifecycle-hook';

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 0, staleTime: 10_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }));
  const hydrate = useAuthStore((state) => state.hydrate);
  useAuthSessionRefresh();
  useDeviceTaskRunnerLifecycle();
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <QueryClientProvider client={client}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <AuthGate>
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTintColor: colors.primary, headerTitleStyle: { color: colors.text, fontWeight: '700' } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="membership" options={{ title: '会员' }} />
          <Stack.Screen name="connections/add" options={{ headerShown: false }} />
          <Stack.Screen name="connections/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="apps/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="approvals" options={{ headerShown: false }} />
          <Stack.Screen name="approvals/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="plan-center" options={{ headerShown: false }} />
          <Stack.Screen name="connections/trusted-devices" options={{ title: '可信设备' }} />
          <Stack.Screen name="connections/notification-sources" options={{ title: '通知来源' }} />
          <Stack.Screen name="truth-store" options={{ title: '已验证事实' }} />
          <Stack.Screen name="domains/[domain]" options={{ headerShown: false }} />
          <Stack.Screen name="domains/[domain]/[scenario]" options={{ headerShown: false }} />
          <Stack.Screen name="connections/[id]/capabilities/[key]" options={{ headerShown: false }} />
          <Stack.Screen name="devices" options={{ headerShown: false }} />
          <Stack.Screen name="vehicles" options={{ headerShown: false }} />
          <Stack.Screen name="notification-settings" options={{ title: '通知' }} />
          <Stack.Screen name="automation-safety" options={{ title: '自动化安全等级' }} />
          <Stack.Screen name="security-center" options={{ headerShown: false }} />
          <Stack.Screen name="data-management" options={{ title: '数据管理' }} />
          <Stack.Screen name="security-activity" options={{ title: '安全记录' }} />
          <Stack.Screen name="oauth/callback" options={{ title: '连接服务' }} />
          <Stack.Screen name="file-import" options={{ title: '导入账单文件' }} />
          <Stack.Screen name="executions/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="executions/[id]/lifecycle" options={{ headerShown: false }} />
          <Stack.Screen name="reconciliation/index" options={{ headerShown: false }} />
          <Stack.Screen name="reconciliation/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="templates/index" options={{ headerShown: false }} />
          <Stack.Screen name="templates/[key]" options={{ title: '模板详情' }} />
          <Stack.Screen name="plans/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="plans/[id]/lifecycle" options={{ headerShown: false }} />
          <Stack.Screen name="strategies/index" options={{ headerShown: false }} />
          <Stack.Screen name="strategies/[strategy]" options={{ headerShown: false }} />
          <Stack.Screen name="truth/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="plans/[id]/edit" options={{ title: '编辑计划' }} />
          <Stack.Screen name="connections/app-read-session" options={{ headerShown: false }} />
          <Stack.Screen name="connections/device-tasks/[id]" options={{ headerShown: false }} />
        </Stack>
      </AuthGate>
    </QueryClientProvider>
  );
}
